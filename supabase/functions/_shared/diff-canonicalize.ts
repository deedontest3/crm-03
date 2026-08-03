// Shared canonicalization + diff helpers used by `diff-backup` and
// `restore-advanced-backup` so the UI numbers and the apply step agree.

export const TS_TYPES = new Set([
  'timestamp with time zone', 'timestamp without time zone',
  'timestamptz', 'timestamp', 'date', 'time', 'timetz',
]);
export const NUM_TYPES = new Set([
  'numeric', 'decimal', 'real', 'double precision',
  'bigint', 'integer', 'smallint',
]);
export const JSON_TYPES = new Set(['jsonb', 'json']);

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CanonicalizeOptions {
  /** Treat "" as null for text columns (default true). */
  emptyStringIsNull?: boolean;
  /** Trim leading/trailing whitespace on strings (default true). */
  trimStrings?: boolean;
  /** Lowercase strings (used per-column for email-like columns). */
  lowercase?: boolean;
}

const DEFAULTS: Required<CanonicalizeOptions> = {
  emptyStringIsNull: true,
  trimStrings: true,
  lowercase: false,
};

/**
 * Canonicalize a single value for comparison. `dt` is the column data type
 * when known (use the BACKUP type first, falling back to LIVE).
 *
 * If `dt` is missing or `unknown`, falls back to format-based normalization
 * for ISO timestamps and dates. Numeric coercion is intentionally NOT done
 * without a type hint to avoid mangling phone numbers etc.
 */
export function canonicalize(v: any, dt?: string, optsIn?: CanonicalizeOptions): any {
  const opts = { ...DEFAULTS, ...(optsIn || {}) };
  if (v === undefined) return null;
  if (v === null) return null;

  const effDt = dt && dt !== 'unknown' ? dt : undefined;
  const isTs = effDt && TS_TYPES.has(effDt);
  const isNum = effDt && NUM_TYPES.has(effDt);
  const isJson = effDt && JSON_TYPES.has(effDt);

  if (isTs) {
    if (typeof v === 'string' || v instanceof Date) {
      const d = new Date(v as any);
      return isNaN(d.getTime()) ? String(v) : d.toISOString();
    }
    return v;
  }

  if (isNum) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s === '') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    }
    return v;
  }

  // No data-type hint: format-based fallback for timestamps/dates only.
  if (!effDt && typeof v === 'string') {
    if (ISO_TS_RE.test(v) || ISO_DATE_RE.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  if (typeof v === 'string') {
    let s = v;
    if (opts.trimStrings) s = s.trim();
    if (opts.lowercase) s = s.toLowerCase();
    if (opts.emptyStringIsNull && s === '') return null;
    return s;
  }

  if (Array.isArray(v)) {
    // Preserve order for typed arrays (text[], etc.) — order is semantically
    // significant in PG arrays. For jsonb arrays, also preserve order.
    return v.map((x) => canonicalize(x, isJson ? 'jsonb' : undefined, opts));
  }

  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = canonicalize((v as any)[k], undefined, opts);
    }
    return out;
  }

  return v;
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/**
 * Columns whose value is set by triggers / server defaults and should NOT
 * count as a "real" row change. Diffs in these columns are still reported,
 * but rows that ONLY differ in these columns are classified as
 * `volatileOnly` instead of `updated`.
 */
export const DEFAULT_VOLATILE_COLUMNS = new Set<string>([
  'updated_at',
  'last_seen_at',
  'last_activity_at',
  'last_login_at',
  'last_sign_in_at',
  'last_used_at',
  'search_tsv',
  'tsv',
  'embedding',
  'fts',
]);

/**
 * Columns matched by name suffix that we also treat as volatile.
 */
const VOLATILE_SUFFIXES = ['_tsv', '_fts', '_embedding'];

export function isVolatileColumn(name: string): boolean {
  if (DEFAULT_VOLATILE_COLUMNS.has(name)) return true;
  for (const s of VOLATILE_SUFFIXES) if (name.endsWith(s)) return true;
  return false;
}

/**
 * Ownership / audit / assignment columns. Differences here are almost always
 * environment-specific (the backup was taken on a different account or with a
 * different owner mapping) and should not count as "real" data updates.
 * They still surface in the row diff so the user can pick old vs new.
 */
export const DEFAULT_METADATA_COLUMNS = new Set<string>([
  'contact_owner', 'account_owner', 'deal_owner', 'lead_owner', 'owner',
  'created_by', 'modified_by', 'updated_by',
  'assigned_to', 'assigned_by',
  'last_modified_by',
]);

const METADATA_SUFFIXES = ['_owner', '_by'];

export function isMetadataColumn(name: string): boolean {
  if (DEFAULT_METADATA_COLUMNS.has(name)) return true;
  const n = name.toLowerCase();
  for (const s of METADATA_SUFFIXES) if (n.endsWith(s)) return true;
  return false;
}

/**
 * Returns true if the column name looks like an email field — used to enable
 * case-insensitive comparison.
 */
export function isEmailColumn(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'email' || n.endsWith('_email') || n === 'email_address';
}
