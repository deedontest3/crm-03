// Shared helper: load and validate an Advanced Backup envelope from a storage path

export async function gunzipToString(input: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(input.byteLength);
  new Uint8Array(ab).set(input);
  const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface LoadedEnvelope {
  envelope: any;
  checksumOk: boolean | null; // null = no checksum present
  rawSize: number;
}

/**
 * Loads an Advanced Backup envelope from the existing private `backups` bucket.
 * Verifies SHA-256 checksum by re-hashing the JSON with the `checksum_sha256`
 * field removed (matches `create-advanced-backup`'s pre-checksum hash).
 */
export async function loadEnvelopeFromPath(adminClient: any, uploadPath: string): Promise<LoadedEnvelope> {
  const { data: blob, error } = await adminClient.storage.from('backups').download(uploadPath);
  if (error || !blob) throw new Error(`Failed to download upload: ${error?.message || 'not found'}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = isGzip(bytes) ? await gunzipToString(bytes) : new TextDecoder().decode(bytes);
  const envelope = JSON.parse(text);
  if (!envelope || typeof envelope !== 'object' || !envelope.data) {
    throw new Error('Invalid backup file: missing data envelope');
  }

  let checksumOk: boolean | null = null;
  if (envelope.checksum_sha256) {
    const { checksum_sha256, ...rest } = envelope;
    const recomputed = await sha256Hex(JSON.stringify(rest));
    checksumOk = recomputed === checksum_sha256;
  }

  return { envelope, checksumOk, rawSize: bytes.byteLength };
}

export function assertAdvancedEnvelope(envelope: any) {
  const v = envelope?.version;
  if ((v === '1.0' || v === '2.0') && envelope?.data && typeof envelope.data === 'object') {
    return;
  }
  if (v === '1.0' || v === '2.0') {
    throw new Error('Invalid backup file: missing data envelope');
  }
  if (v !== '2.0') {
    throw new Error(
      `Unsupported backup format "${v ?? 'unknown'}". Please upload a valid backup JSON file.`
    );
  }
}
