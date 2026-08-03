// Client-side analyzers for the Contacts cleanup dialog.
// Pure functions — no side effects, no supabase calls. Fully unit testable.
//
// Rule catalog (14 checks, tiered by severity):
//   HIGH   exact_dup_email, exact_dup_phone, exact_dup_name_company,
//          orphan_account, malformed_email, malformed_phone
//   MED    fuzzy_dup_name_company, cross_account_dup, placeholder, thin, no_account
//   LOW    unlinked, stale

export interface CleanupContact {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  position?: string | null;
  email?: string | null;
  phone_no?: string | null;
  
  contact_owner?: string | null;
  account_id?: string | null;
  last_activity_time?: string | null;
  modified_time?: string | null;
  created_time?: string | null;
}

export type ContactIssueKey =
  | "exact_dup_email"
  | "exact_dup_phone"
  | "exact_dup_name_company"
  | "fuzzy_dup_name_company"
  | "cross_account_dup"
  | "orphan_account"
  | "no_account"
  | "unlinked"
  | "thin"
  | "placeholder"
  | "malformed_email"
  | "malformed_phone"
  | "stale";

export type Severity = "high" | "medium" | "low";

export const SEVERITY_MAP: Record<ContactIssueKey, Severity> = {
  exact_dup_email: "high",
  exact_dup_phone: "high",
  exact_dup_name_company: "high",
  orphan_account: "high",
  malformed_email: "high",
  malformed_phone: "high",
  fuzzy_dup_name_company: "medium",
  cross_account_dup: "medium",
  placeholder: "medium",
  thin: "medium",
  no_account: "medium",
  unlinked: "low",
  stale: "low",
};


const LEGAL_SUFFIXES = [
  "ltd", "limited", "inc", "incorporated", "llc", "llp", "gmbh", "pvt", "private",
  "co", "corp", "corporation", "plc", "sa", "srl", "bv", "ag", "kg", "oy", "spa",
  "pty", "sarl", "kft", "as", "ab",
];

const NAME_PREFIXES = ["mr", "mrs", "ms", "miss", "dr", "prof", "sri", "smt"];
const NAME_SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "phd", "md", "esq"];

export const normalizePersonName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  let s = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\p{Letter}\p{Number}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  const parts = s.split(" ").filter(Boolean);
  while (parts.length && NAME_PREFIXES.includes(parts[0])) parts.shift();
  while (parts.length && NAME_SUFFIXES.includes(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
};

export const normalizeCompany = (raw: string | null | undefined): string => {
  if (!raw) return "";
  let s = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim();
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

export const normalizeEmail = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const s = raw.trim().toLowerCase();
  // strip gmail plus-tag & dots in local part for gmail/googlemail only
  const [local, domain] = s.split("@");
  if (!domain) return s;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const base = (local || "").split("+")[0].replace(/\./g, "");
    return `${base}@gmail.com`;
  }
  return `${(local || "").split("+")[0]}@${domain}`;
};

export const normalizePhone = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLACEHOLDER_RE = /^(test\d*|demo\d*|sample|asdf+|xxx+|n\/?a|unknown|none|null|-+|\.+|todo|contact|person)$/i;

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
  reason:
    | "same_email"
    | "same_phone"
    | "same_name_company"
    | "fuzzy_name_company"
    | "cross_account";
  contactIds: string[];
}

const groupBy = <T,>(items: T[], keyOf: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return m;
};

export const findEmailDuplicates = (contacts: CleanupContact[]): DuplicateGroup[] => {
  const byEmail = groupBy(contacts, (c) => normalizeEmail(c.email));
  const out: DuplicateGroup[] = [];
  for (const [key, arr] of byEmail) {
    if (arr.length > 1) out.push({ key: `email:${key}`, reason: "same_email", contactIds: arr.map((c) => c.id) });
  }
  return out;
};

export const findPhoneDuplicates = (contacts: CleanupContact[]): DuplicateGroup[] => {
  const byPhone = groupBy(contacts, (c) => {
    const p = normalizePhone(c.phone_no);
    return p.length >= 7 ? p : "";
  });
  const out: DuplicateGroup[] = [];
  for (const [key, arr] of byPhone) {
    if (arr.length > 1) out.push({ key: `phone:${key}`, reason: "same_phone", contactIds: arr.map((c) => c.id) });
  }
  return out;
};

const nameCompanyKey = (c: CleanupContact, accountNameById: Map<string, string>): string => {
  const n = normalizePersonName(c.contact_name);
  if (!n) return "";
  const company = c.company_name || (c.account_id ? accountNameById.get(c.account_id) : "") || "";
  const cn = normalizeCompany(company);
  return cn ? `${n}|${cn}` : `${n}|`;
};

export const findNameCompanyDuplicates = (
  contacts: CleanupContact[],
  accountNameById: Map<string, string>,
): DuplicateGroup[] => {
  const grouped = groupBy(contacts, (c) => nameCompanyKey(c, accountNameById));
  const out: DuplicateGroup[] = [];
  for (const [key, arr] of grouped) {
    if (arr.length > 1) out.push({ key: `nc:${key}`, reason: "same_name_company", contactIds: arr.map((c) => c.id) });
  }
  return out;
};

/** Fuzzy: same normalized company AND person-name Levenshtein ≤ 2. */
export const findFuzzyNameCompanyDuplicates = (
  contacts: CleanupContact[],
  accountNameById: Map<string, string>,
): DuplicateGroup[] => {
  const out: DuplicateGroup[] = [];
  const byCompany = new Map<string, { id: string; n: string }[]>();
  for (const c of contacts) {
    const n = normalizePersonName(c.contact_name);
    if (n.length < 3) continue;
    const company = c.company_name || (c.account_id ? accountNameById.get(c.account_id) : "") || "";
    const cn = normalizeCompany(company);
    if (!cn) continue;
    const arr = byCompany.get(cn) ?? [];
    arr.push({ id: c.id, n });
    byCompany.set(cn, arr);
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
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
  const groupMembers = new Map<string, string[]>();
  for (const [cn, arr] of byCompany) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (a.n === b.n) continue;
        if (Math.abs(a.n.length - b.n.length) > 2) continue;
        if (levenshtein(a.n, b.n) <= 2) {
          union(a.id, b.id);
          fuzzyIds.add(a.id);
          fuzzyIds.add(b.id);
          groupMembers.set(cn, [...(groupMembers.get(cn) ?? []), a.id, b.id]);
        }
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
    if (ids.length > 1) out.push({ key: `fuzzy-nc:${key}`, reason: "fuzzy_name_company", contactIds: Array.from(new Set(ids)) });
  }
  return out;
};

/** Same email OR same normalized person-name, but linked to different accounts. */
export const findCrossAccountDuplicates = (contacts: CleanupContact[]): DuplicateGroup[] => {
  const out: DuplicateGroup[] = [];
  const consider = (grouper: (c: CleanupContact) => string, prefix: string) => {
    const groups = groupBy(contacts, grouper);
    for (const [k, arr] of groups) {
      if (arr.length < 2) continue;
      const accounts = new Set(arr.map((c) => c.account_id).filter(Boolean) as string[]);
      if (accounts.size >= 2) {
        out.push({ key: `xacct-${prefix}:${k}`, reason: "cross_account", contactIds: arr.map((c) => c.id) });
      }
    }
  };
  consider((c) => normalizeEmail(c.email), "email");
  consider((c) => normalizePersonName(c.contact_name), "name");
  return out;
};

export const isPlaceholderContact = (c: CleanupContact): boolean => {
  const name = (c.contact_name || "").trim();
  if (!name || name.length < 2) return true;
  const norm = normalizePersonName(name);
  if (!norm) return true;
  if (PLACEHOLDER_RE.test(name)) return true;
  // Only flag a single-token name as placeholder — avoid false-positives
  // like "Todo" being a real last name inside a longer full name.
  if (!norm.includes(" ") && PLACEHOLDER_RE.test(norm)) return true;

  return false;
};

export const isMalformedEmail = (c: CleanupContact): boolean => {
  if (!c.email || !c.email.trim()) return false;
  return !EMAIL_RE.test(c.email.trim());
};

export const isMalformedPhone = (c: CleanupContact): boolean => {
  if (!c.phone_no || !c.phone_no.trim()) return false;
  const digits = (c.phone_no.match(/\d/g) || []).length;
  return digits > 0 && digits < 7;
};

export const isThinContact = (c: CleanupContact): boolean => {
  const fields = [c.email, c.phone_no, c.position, c.company_name, c.account_id];
  return fields.every((f) => !f || String(f).trim() === "");
};

export const isStaleContact = (c: CleanupContact, now: Date = new Date()): boolean => {
  const ts = c.last_activity_time || c.modified_time || c.created_time;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  const months = (now.getTime() - t) / (1000 * 60 * 60 * 24 * 30);
  return months > 12;
};

export interface AnalyzeContactsInput {
  contacts: CleanupContact[];
  dealCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
  validAccountIds: Set<string>;
  accountNameById: Map<string, string>;
  now?: Date;
}

export interface AnalyzeContactsResult {
  issuesByContact: Record<string, ContactIssueKey[]>;
  emailGroups: DuplicateGroup[];
  phoneGroups: DuplicateGroup[];
  nameCompanyGroups: DuplicateGroup[];
  fuzzyNameCompanyGroups: DuplicateGroup[];
  crossAccountGroups: DuplicateGroup[];
  counts: Record<ContactIssueKey, number>;
  severityByContact: Record<string, Severity>;
}

const worstSeverity = (issues: ContactIssueKey[]): Severity => {
  let s: Severity = "low";
  for (const k of issues) {
    const sev = SEVERITY_MAP[k];
    if (sev === "high") return "high";
    if (sev === "medium") s = s === "low" ? "medium" : s;
  }
  return s;
};

export const analyzeContacts = ({
  contacts, dealCounts, campaignCounts, validAccountIds, accountNameById, now,
}: AnalyzeContactsInput): AnalyzeContactsResult => {
  const emailGroups = findEmailDuplicates(contacts);
  const phoneGroups = findPhoneDuplicates(contacts);
  const nameCompanyGroups = findNameCompanyDuplicates(contacts, accountNameById);
  const fuzzyNameCompanyGroups = findFuzzyNameCompanyDuplicates(contacts, accountNameById);
  const crossAccountGroups = findCrossAccountDuplicates(contacts);

  const inEmail = new Set(emailGroups.flatMap((g) => g.contactIds));
  const inPhone = new Set(phoneGroups.flatMap((g) => g.contactIds));
  const inNC = new Set(nameCompanyGroups.flatMap((g) => g.contactIds));
  const inFuzzyNC = new Set(fuzzyNameCompanyGroups.flatMap((g) => g.contactIds));
  const inCross = new Set(crossAccountGroups.flatMap((g) => g.contactIds));

  const issuesByContact: Record<string, ContactIssueKey[]> = {};
  const severityByContact: Record<string, Severity> = {};
  const counts: Record<ContactIssueKey, number> = {
    exact_dup_email: 0, exact_dup_phone: 0, exact_dup_name_company: 0,
    fuzzy_dup_name_company: 0, cross_account_dup: 0, orphan_account: 0,
    no_account: 0, unlinked: 0, thin: 0, placeholder: 0,
    malformed_email: 0, malformed_phone: 0, stale: 0,
  };


  for (const c of contacts) {
    const iss: ContactIssueKey[] = [];
    if (inEmail.has(c.id)) iss.push("exact_dup_email");
    if (inPhone.has(c.id)) iss.push("exact_dup_phone");
    if (inNC.has(c.id)) iss.push("exact_dup_name_company");
    if (inFuzzyNC.has(c.id) && !inNC.has(c.id)) iss.push("fuzzy_dup_name_company");
    if (inCross.has(c.id)) iss.push("cross_account_dup");

    if (c.account_id && !validAccountIds.has(c.account_id)) iss.push("orphan_account");
    if (!c.account_id && !(c.company_name && c.company_name.trim())) iss.push("no_account");

    const d = dealCounts[c.id] ?? 0;
    const cc = campaignCounts[c.id] ?? 0;
    if (d === 0 && cc === 0) iss.push("unlinked");
    if (isThinContact(c)) iss.push("thin");
    if (isPlaceholderContact(c)) iss.push("placeholder");
    if (isMalformedEmail(c)) iss.push("malformed_email");
    if (isMalformedPhone(c)) iss.push("malformed_phone");
    if (isStaleContact(c, now) && d === 0 && cc === 0) iss.push("stale");


    if (iss.length) {
      issuesByContact[c.id] = iss;
      severityByContact[c.id] = worstSeverity(iss);
      for (const k of iss) counts[k]++;
    }
  }

  return {
    issuesByContact,
    emailGroups,
    phoneGroups,
    nameCompanyGroups,
    fuzzyNameCompanyGroups,
    crossAccountGroups,
    counts,
    severityByContact,
  };
};

/** Auto-suggest survivor: prefer richest record (most filled fields + most links). */
export const suggestSurvivor = (
  contacts: CleanupContact[],
  linkScore: (id: string) => number,
): CleanupContact | undefined => {
  const score = (c: CleanupContact) => {
    const filled = [c.email, c.phone_no, c.position, c.company_name, c.account_id, c.contact_owner]
      .filter((f) => !!f && String(f).trim() !== "").length;
    return linkScore(c.id) * 10 + filled;
  };
  return [...contacts].sort((a, b) => score(b) - score(a))[0];
};
