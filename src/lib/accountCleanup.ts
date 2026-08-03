// Client-side analyzers for the Accounts cleanup dialog.
// Pure functions — no side effects, no supabase calls. Fully unit testable.

export interface CleanupAccount {
  id: string;
  account_name: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  description?: string | null;
  account_owner?: string | null;
  company_type?: string | null;
  region?: string | null;
  modified_time?: string | null;
  created_time?: string | null;
}

export type IssueKey =
  | "exact_dup"
  | "fuzzy_dup"
  | "unlinked"
  | "thin"
  | "placeholder"
  | "malformed"
  | "stale"
  | "no_owner";

const LEGAL_SUFFIXES = [
  "ltd", "limited", "inc", "incorporated", "llc", "llp", "gmbh", "pvt", "private",
  "co", "corp", "corporation", "plc", "sa", "srl", "bv", "ag", "kg", "oy", "spa",
  "pty", "sarl", "kft", "as", "ab",
];

export const normalizeName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  let s = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\p{Letter}\p{Number}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  // strip trailing legal suffixes (repeatedly)
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      const re = new RegExp(`(^|\\s)${suf}$`);
      if (re.test(s)) { s = s.replace(re, "").trim(); changed = true; }
    }
  }
  return s;
};

export const normalizeDomain = (raw: string | null | undefined): string => {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  return s.trim();
};

export const normalizePhone = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

// Levenshtein distance (small strings; O(n*m) is fine).
export const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
};

export interface DuplicateGroup {
  key: string;
  reason: "exact_name" | "fuzzy_name" | "same_domain" | "same_phone";
  accountIds: string[];
}

export const findExactDuplicateGroups = (accounts: CleanupAccount[]): DuplicateGroup[] => {
  const byName = new Map<string, string[]>();
  for (const a of accounts) {
    const n = normalizeName(a.account_name);
    if (!n) continue;
    const arr = byName.get(n) ?? [];
    arr.push(a.id);
    byName.set(n, arr);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, ids] of byName) {
    if (ids.length > 1) out.push({ key, reason: "exact_name", accountIds: ids });
  }
  return out;
};

// Guard: the O(n²) fuzzy pass is safe for a few thousand accounts but starts
// to jank the browser well before that. Skip fuzzy grouping past this cap and
// rely on exact/domain/phone dedup only — the user can still find near-dupes
// via the search box.
const FUZZY_ACCOUNT_CAP = 2000;

export const findFuzzyDuplicateGroups = (accounts: CleanupAccount[]): DuplicateGroup[] => {
  const groups: DuplicateGroup[] = [];
  const skipFuzzyName = accounts.length > FUZZY_ACCOUNT_CAP;

  // by domain
  const byDomain = new Map<string, string[]>();
  for (const a of accounts) {
    const d = normalizeDomain(a.website);
    if (!d || !d.includes(".")) continue;
    const arr = byDomain.get(d) ?? [];
    arr.push(a.id);
    byDomain.set(d, arr);
  }
  for (const [key, ids] of byDomain) {
    if (ids.length > 1) groups.push({ key, reason: "same_domain", accountIds: ids });
  }

  // by phone
  const byPhone = new Map<string, string[]>();
  for (const a of accounts) {
    const p = normalizePhone(a.phone);
    if (!p || p.length < 7) continue;
    const arr = byPhone.get(p) ?? [];
    arr.push(a.id);
    byPhone.set(p, arr);
  }
  for (const [key, ids] of byPhone) {
    if (ids.length > 1) groups.push({ key, reason: "same_phone", accountIds: ids });
  }

  // fuzzy name (Levenshtein ≤ 2), bucketed by length ±2 to keep O(n*k) small.
  // Skipped entirely on very large workspaces (see FUZZY_ACCOUNT_CAP).
  if (skipFuzzyName) return groups;
  const normed = accounts
    .map((a) => ({ id: a.id, n: normalizeName(a.account_name) }))
    .filter((x) => x.n.length >= 3);
  const byLen = new Map<number, { id: string; n: string }[]>();
  for (const x of normed) {
    for (const L of [x.n.length - 1, x.n.length, x.n.length + 1]) {
      const arr = byLen.get(L) ?? [];
      arr.push(x);
      byLen.set(L, arr);
    }
  }
  const seenPair = new Set<string>();
  // Union-find for connected fuzzy pairs
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const fuzzyIds = new Set<string>();
  for (const x of normed) {
    const bucket = byLen.get(x.n.length) ?? [];
    for (const y of bucket) {
      if (x.id === y.id) continue;
      const pairKey = x.id < y.id ? `${x.id}|${y.id}` : `${y.id}|${x.id}`;
      if (seenPair.has(pairKey)) continue;
      seenPair.add(pairKey);
      if (x.n === y.n) continue; // exact handled elsewhere
      if (Math.abs(x.n.length - y.n.length) > 2) continue;
      const d = levenshtein(x.n, y.n);
      if (d > 0 && d <= 2) {
        union(x.id, y.id);
        fuzzyIds.add(x.id);
        fuzzyIds.add(y.id);
      }
    }
  }
  const clusters = new Map<string, string[]>();
  for (const id of fuzzyIds) {
    const r = find(id);
    const arr = clusters.get(r) ?? [];
    arr.push(id);
    clusters.set(r, arr);
  }
  for (const [key, ids] of clusters) {
    if (ids.length > 1) groups.push({ key: `fuzzy:${key}`, reason: "fuzzy_name", accountIds: ids });
  }

  return groups;
};

const PLACEHOLDER_RE = /^(test\d*|demo\d*|sample|asdf+|xxx+|n\/?a|unknown|none|null|-+|\.+|todo)$/i;

export const isPlaceholder = (a: CleanupAccount): boolean => {
  const name = (a.account_name || "").trim();
  if (!name || name.length < 2) return true;
  if (PLACEHOLDER_RE.test(name)) return true;
  return false;
};

export const isMalformed = (a: CleanupAccount): string[] => {
  const issues: string[] = [];
  const name = (a.account_name || "").trim();
  if (name.includes("@")) issues.push("name looks like email");
  if (/^https?:\/\//i.test(name)) issues.push("name looks like URL");
  if (a.website) {
    const d = normalizeDomain(a.website);
    if (d && !d.includes(".")) issues.push("invalid website");
  }
  if (a.phone) {
    const digits = (a.phone.match(/\d/g) || []).length;
    if (digits > 0 && digits < 7) issues.push("phone too short");
  }
  return issues;
};

export const isThin = (a: CleanupAccount): boolean => {
  const fields = [a.industry, a.country, a.phone, a.website, a.description, a.company_type, a.region];
  return fields.every((f) => !f || String(f).trim() === "");
};

export const isStale = (a: CleanupAccount, now: Date = new Date()): boolean => {
  const ts = a.modified_time || a.created_time;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  const months = (now.getTime() - t) / (1000 * 60 * 60 * 24 * 30);
  return months > 12;
};

export interface AnalyzeInput {
  accounts: CleanupAccount[];
  contactCounts: Record<string, number>;
  dealCounts: Record<string, number>;
  now?: Date;
}

export interface AnalyzeResult {
  issuesByAccount: Record<string, IssueKey[]>;
  exactGroups: DuplicateGroup[];
  fuzzyGroups: DuplicateGroup[];
  counts: Record<IssueKey, number>;
  malformedReasons: Record<string, string[]>;
}

export const analyzeAccounts = ({ accounts, contactCounts, dealCounts, now }: AnalyzeInput): AnalyzeResult => {
  const exactGroups = findExactDuplicateGroups(accounts);
  const fuzzyGroups = findFuzzyDuplicateGroups(accounts);
  const inExact = new Set(exactGroups.flatMap((g) => g.accountIds));
  const inFuzzy = new Set(fuzzyGroups.flatMap((g) => g.accountIds));

  const issuesByAccount: Record<string, IssueKey[]> = {};
  const malformedReasons: Record<string, string[]> = {};
  const counts: Record<IssueKey, number> = {
    exact_dup: 0, fuzzy_dup: 0, unlinked: 0, thin: 0, placeholder: 0, malformed: 0, stale: 0, no_owner: 0,
  };

  for (const a of accounts) {
    const iss: IssueKey[] = [];
    if (inExact.has(a.id)) iss.push("exact_dup");
    if (inFuzzy.has(a.id)) iss.push("fuzzy_dup");
    const c = contactCounts[a.id] ?? 0;
    const d = dealCounts[a.id] ?? 0;
    if (c === 0 && d === 0) iss.push("unlinked");
    if (isThin(a)) iss.push("thin");
    if (isPlaceholder(a)) iss.push("placeholder");
    const mal = isMalformed(a);
    if (mal.length) { iss.push("malformed"); malformedReasons[a.id] = mal; }
    if (isStale(a, now) && c === 0 && d === 0) iss.push("stale");
    if (!a.account_owner || String(a.account_owner).trim() === "") iss.push("no_owner");
    if (iss.length) issuesByAccount[a.id] = iss;
    for (const k of iss) counts[k]++;
  }

  return { issuesByAccount, exactGroups, fuzzyGroups, counts, malformedReasons };
};