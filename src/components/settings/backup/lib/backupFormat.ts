import pako from 'pako';

export const ADVANCED_ENVELOPE_VERSION = '2.0';

export interface AdvancedBackupEnvelope {
  version: string;
  created_at: string;
  source_project_ref?: string;
  checksum_sha256?: string;
  compressed?: boolean;
  schema?: any;
  auth_users?: Array<{ id: string; email: string | null; created_at?: string }>;
  storage?: Record<string, Array<{ name: string; size?: number; mime?: string }>>;
  tables: string[];
  manifest: Record<string, number>;
  data: Record<string, any[]>;
  filters?: Record<string, { column: string; from?: string; to?: string }>;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // Ensure a clean ArrayBuffer (avoids SharedArrayBuffer typing issues)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function gzipString(input: string): Uint8Array {
  return pako.gzip(input);
}

export function gunzipToString(input: Uint8Array): string {
  return pako.ungzip(input, { to: 'string' });
}

export async function parseBackupFile(file: File): Promise<AdvancedBackupEnvelope> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isGz =
    file.name.toLowerCase().endsWith('.gz') ||
    (buf[0] === 0x1f && buf[1] === 0x8b);
  const text = isGz ? gunzipToString(buf) : new TextDecoder().decode(buf);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('Invalid backup file: missing data envelope');
  }
  return parsed as AdvancedBackupEnvelope;
}
