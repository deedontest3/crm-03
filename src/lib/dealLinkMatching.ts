import { supabase } from "@/integrations/supabase/client";

export interface AccountLinkTarget {
  id: string;
  account_name: string;
}

export interface ContactLinkTarget {
  id: string;
  contact_name?: string | null;
  company_name?: string | null;
  account_id?: string | null;
}

export interface LinkedDeal {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  lead_name: string | null;
  stage: string | null;
  total_contract_value: number | null;
  account_id: string | null;
  budget_owner_contact_id?: string | null;
  champion_contact_id?: string | null;
  objector_contact_id?: string | null;
  influencer_contact_id?: string | null;
  source_campaign_contact_id?: string | null;
}

export interface LinkableContact {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  account_id: string | null;
}

export interface LinkableAccount {
  id: string;
  account_name: string | null;
}

export interface CampaignContactLink {
  id: string;
  contact_id: string | null;
  account_id: string | null;
}

export interface DealStakeholderLink {
  deal_id: string | null;
  contact_id: string | null;
}

export const DEAL_CONTACT_FIELDS = [
  "budget_owner_contact_id",
  "champion_contact_id",
  "objector_contact_id",
  "influencer_contact_id",
] as const;

export const unique = <T,>(items: Array<T | null | undefined>) =>
  [...new Set(items.filter(Boolean))] as T[];

export const normalize = (value?: string | null) =>
  (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeCompany = (value?: string | null) =>
  normalize(value)
    .replace(/\b(ltd|limited|inc|incorporated|gmbh|corp|corporation|company|co|llc|plc|ag|bv|nv|pte|pvt|llp|hq|usa|us|uk|germany|switzerland|india|europe|global|group|solutions|systems|technologies|technology)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isMissingName = (value?: string | null) => {
  const n = normalize(value);
  return !n || n === "-" || n === "na" || n === "n a" || n === "n/a";
};

const DISTINGUISHING_TOKEN = /^(\d+|north|south|east|west|hq|emea|apac|amer|latam|i|ii|iii|iv|v)$/;

export const hasUnsharedDistinguishingToken = (a: string, b: string) => {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  for (const t of tokensA) {
    if (DISTINGUISHING_TOKEN.test(t) && !tokensB.has(t)) return true;
  }
  for (const t of tokensB) {
    if (DISTINGUISHING_TOKEN.test(t) && !tokensA.has(t)) return true;
  }
  return false;
};

export const namesMatch = (left?: string | null, right?: string | null) => {
  const cleanLeft = normalize(left);
  const cleanRight = normalize(right);
  if (!cleanLeft || !cleanRight) return false;
  if (cleanLeft === cleanRight) return true;
  if (hasUnsharedDistinguishingToken(cleanLeft, cleanRight)) return false;
  const [shorter, longer] = cleanLeft.length <= cleanRight.length
    ? [cleanLeft, cleanRight]
    : [cleanRight, cleanLeft];
  if (shorter.length < 10) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(longer);
};

export const companiesMatch = (company?: string | null, target?: string | null) => {
  const rawCompany = normalize(company);
  const rawTarget = normalize(target);
  if (!rawCompany || !rawTarget) return false;
  if (rawCompany === rawTarget) return true;

  // Reject pairs whose raw forms differ only by a distinguishing qualifier
  // (digits, region codes, HQ, etc.). e.g. "RT India" vs "RT India 1".
  if (hasUnsharedDistinguishingToken(rawCompany, rawTarget)) return false;

  const cleanCompany = normalizeCompany(company);
  const cleanTarget = normalizeCompany(target);
  if (!cleanCompany || !cleanTarget) return false;
  if (cleanCompany === cleanTarget) return true;

  const minStrongLength = Math.min(cleanCompany.length, cleanTarget.length) <= 4 ? 4 : 6;
  if (cleanCompany.length >= minStrongLength && cleanTarget.length >= minStrongLength) {
    if (
      cleanCompany.startsWith(`${cleanTarget} `) ||
      cleanTarget.startsWith(`${cleanCompany} `) ||
      cleanCompany.endsWith(` ${cleanTarget}`) ||
      cleanTarget.endsWith(` ${cleanCompany}`)
    ) {
      return true;
    }
  }

  const companyTokens = cleanCompany.split(" ").filter((token) => token.length >= 4);
  const targetTokens = cleanTarget.split(" ").filter((token) => token.length >= 4);
  if (companyTokens.length === 0 || targetTokens.length === 0) return false;
  const [shorter, longer] = companyTokens.length <= targetTokens.length
    ? [companyTokens, new Set(targetTokens)]
    : [targetTokens, new Set(companyTokens)];
  const sharedTokens = shorter.filter((token) => longer.has(token));
  if (sharedTokens.length === 0) return false;
  // Require 2+ shared significant tokens, OR a single shared token of length >=6
  // when one side is a single-token name (e.g. "Bosch" ↔ "Bosch Mobility Solutions").
  if (sharedTokens.length >= 2) return true;
  if (sharedTokens[0].length >= 5 && shorter.length === 1) return true;
  return false;
};

export const sortDeals = (deals: LinkedDeal[]) =>
  [...deals].sort((a, b) =>
    (a.project_name || a.customer_name || "").localeCompare(b.project_name || b.customer_name || "")
  );

export const fetchAllDealsForLinking = async (): Promise<LinkedDeal[]> => {
  const all: LinkedDeal[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("deals")
      .select("id, project_name, customer_name, lead_name, stage, total_contract_value, account_id, budget_owner_contact_id, champion_contact_id, objector_contact_id, influencer_contact_id, source_campaign_contact_id")
      .order("project_name", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as LinkedDeal[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

export const fetchAllContactsForLinking = async (): Promise<LinkableContact[]> => {
  const all: LinkableContact[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, contact_name, company_name, account_id")
      .order("contact_name", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as LinkableContact[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

export const fetchAllAccountsForLinking = async (): Promise<LinkableAccount[]> => {
  const all: LinkableAccount[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, account_name")
      .order("account_name", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as LinkableAccount[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

const IN_CHUNK = 100;

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const fetchDealStakeholderLinks = async (dealIds: string[]) => {
  const ids = unique(dealIds);
  if (ids.length === 0) return [] as DealStakeholderLink[];
  const out: DealStakeholderLink[] = [];
  for (const c of chunk(ids, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("deal_stakeholders")
      .select("deal_id, contact_id")
      .in("deal_id", c);
    if (error) throw error;
    out.push(...((data || []) as DealStakeholderLink[]));
  }
  return out;
};

export const fetchCampaignContactLinks = async (campaignContactIds: Array<string | null | undefined>) => {
  const ids = unique(campaignContactIds);
  if (ids.length === 0) return [] as CampaignContactLink[];
  const out: CampaignContactLink[] = [];
  for (const c of chunk(ids, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("campaign_contacts")
      .select("id, contact_id, account_id")
      .in("id", c);
    if (error) throw error;
    out.push(...((data || []) as CampaignContactLink[]));
  }
  return out;
};

export const getDealDirectContactIds = (deal: LinkedDeal) =>
  unique(DEAL_CONTACT_FIELDS.map((field) => deal[field]));
