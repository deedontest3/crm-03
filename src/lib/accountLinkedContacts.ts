import { supabase } from "@/integrations/supabase/client";

export interface AccountLinkTarget {
  id: string;
  account_name: string;
}

export interface LinkedAccountContact {
  id: string;
  contact_name: string;
  company_name?: string | null;
  position?: string | null;
  email?: string | null;
  phone_no?: string | null;
  account_id?: string | null;
  link_sources?: string[] | null;
}

interface DealLinkRow {
  id: string;
  account_id: string | null;
  customer_name: string | null;
  lead_name: string | null;
  budget_owner_contact_id: string | null;
  champion_contact_id: string | null;
  objector_contact_id: string | null;
  influencer_contact_id: string | null;
  source_campaign_contact_id: string | null;
}

const DEAL_CONTACT_FIELDS: Array<keyof Pick<
  DealLinkRow,
  | "budget_owner_contact_id"
  | "champion_contact_id"
  | "objector_contact_id"
  | "influencer_contact_id"
>> = [
  "budget_owner_contact_id",
  "champion_contact_id",
  "objector_contact_id",
  "influencer_contact_id",
];

const normalize = (value?: string | null) =>
  (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeCompany = (value?: string | null) =>
  normalize(value)
    .replace(/\b(ltd|limited|inc|incorporated|gmbh|corp|corporation|company|co|llc|plc|ag|bv|pte|pvt|hq|usa|us|uk|germany|switzerland|india|europe|global|group)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isMissingName = (value?: string | null) => {
  const normalized = normalize(value);
  return !normalized || normalized === "-" || normalized === "na" || normalized === "n a";
};

const namesMatch = (left?: string | null, right?: string | null) =>
  !isMissingName(left) && normalize(left) === normalize(right);

const companiesMatch = (company?: string | null, target?: string | null) => {
  const rawCompany = normalize(company);
  const rawTarget = normalize(target);
  if (!rawCompany || !rawTarget) return false;
  if (rawCompany === rawTarget) return true;

  const cleanCompany = normalizeCompany(company);
  const cleanTarget = normalizeCompany(target);
  if (!cleanCompany || !cleanTarget) return false;
  if (cleanCompany === cleanTarget) return true;

  // Allow strong prefix/contains matches such as "ClearMotion" ↔ "ClearMotion Ltd, UK"
  // while avoiding very short broad matches such as "BMW" or "VW".
  const minStrongLength = cleanTarget.length <= 4 ? 4 : 6;
  if (cleanTarget.length < minStrongLength) return false;
  return cleanCompany.startsWith(`${cleanTarget} `) || cleanTarget.startsWith(`${cleanCompany} `);
};

const unique = <T,>(items: T[]) => [...new Set(items.filter(Boolean))] as T[];

const chunk = <T,>(arr: T[], size: number): T[][] => {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Keep chunks small enough to (a) stay under PostgREST URL limits when the id
// list is inlined into `?col=in.(...)` and (b) let the RPC finish under the
// Supabase statement timeout on large workspaces.
const ID_CHUNK = 100;

interface LinkedContactsRpcRow {
  account_id: string;
  contact_id: string;
  contact_name: string;
  company_name: string | null;
  contact_position?: string | null;
  position?: string | null;
  email: string | null;
  phone_no: string | null;
  contact_account_id: string | null;
  link_sources: string[] | null;
}

const tryFetchLinkedContactsViaRpc = async (
  accounts: AccountLinkTarget[]
): Promise<Record<string, LinkedAccountContact[]> | null> => {
  const accountIds = unique(accounts.map((account) => account.id));
  if (accountIds.length === 0) return {};

  try {
    const buckets: Record<string, LinkedAccountContact[]> = Object.fromEntries(
      accountIds.map((id) => [id, []])
    );

    for (const idsChunk of chunk(accountIds, ID_CHUNK)) {
      const { data, error } = await supabase.rpc("get_account_linked_contacts", {
        _account_ids: idsChunk,
      });
      if (error) throw error;

      ((data || []) as LinkedContactsRpcRow[]).forEach((row) => {
        if (!row.account_id || !buckets[row.account_id]) return;
        buckets[row.account_id].push({
          id: row.contact_id,
          contact_name: row.contact_name,
          company_name: row.company_name,
          position: row.contact_position ?? row.position,
          email: row.email,
          phone_no: row.phone_no,
          account_id: row.contact_account_id,
          link_sources: row.link_sources,
        });
      });
    }

    // Dedupe per account (chunks are disjoint by account_id, but the RPC may
    // return the same contact via multiple link sources within a chunk).
    Object.keys(buckets).forEach((accountId) => {
      const seen = new Map<string, LinkedAccountContact>();
      for (const c of buckets[accountId]) if (!seen.has(c.id)) seen.set(c.id, c);
      buckets[accountId] = [...seen.values()].sort((a, b) =>
        (a.contact_name || "").localeCompare(b.contact_name || "")
      );
    });

    return buckets;
  } catch (error) {
    // Older databases may not have the SECURITY DEFINER RPC yet. Keep the UI
    // working through the client-side fallback, but log the real cause so this
    // problem is visible during debugging instead of silently showing zeroes.
    console.warn("get_account_linked_contacts RPC unavailable; using client fallback", error);
    return null;
  }
};

const fetchAllContacts = async (): Promise<LinkedAccountContact[]> => {
  const all: LinkedAccountContact[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, contact_name, company_name, position, email, phone_no, account_id")
      .order("contact_name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = (data || []) as LinkedAccountContact[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

export const getAccountLinkedContacts = async (
  accounts: AccountLinkTarget[]
): Promise<Record<string, LinkedAccountContact[]>> => {
  const accountIds = unique(accounts.map((account) => account.id));
  if (accountIds.length === 0) return {};

  const rpcContacts = await tryFetchLinkedContactsViaRpc(accounts);
  if (rpcContacts) return rpcContacts;

  // The client-side fallback loads every contact + every referenced deal into
  // memory. On huge workspaces (>1000 accounts) that would blow up the browser,
  // so hard-bail with a clear message. For medium workspaces (200-1000) we
  // continue but log a warning — the previous 200-cap error was noisy and
  // showed as a repeated toast every 5 minutes via React Query refetches.
  if (accountIds.length > 1000) {
    throw new Error(
      `Linked-contact RPC unavailable and dataset is too large (${accountIds.length} accounts) for the client fallback. Please apply the get_account_linked_contacts migration.`
    );
  }
  if (accountIds.length > 200) {
    console.warn(
      `getAccountLinkedContacts fallback running on ${accountIds.length} accounts — consider deploying the get_account_linked_contacts RPC for better performance.`
    );
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const buckets: Record<string, Map<string, LinkedAccountContact>> = Object.fromEntries(
    accountIds.map((id) => [id, new Map<string, LinkedAccountContact>()])
  );


  const fetchDealsInChunks = async (): Promise<DealLinkRow[]> => {
    const out: DealLinkRow[] = [];
    for (const idsChunk of chunk(accountIds, ID_CHUNK)) {
      const { data, error } = await supabase
        .from("deals")
        .select("id, account_id, customer_name, lead_name, budget_owner_contact_id, champion_contact_id, objector_contact_id, influencer_contact_id, source_campaign_contact_id")
        .in("account_id", idsChunk);
      if (error) throw error;
      out.push(...((data || []) as DealLinkRow[]));
    }
    return out;
  };

  const [dealRows, allContacts] = await Promise.all([
    fetchDealsInChunks(),
    fetchAllContacts(),
  ]);

  const deals = dealRows.filter((deal) => !!deal.account_id);
  const dealIds = unique(deals.map((deal) => deal.id));
  const contactsById = new Map(allContacts.map((contact) => [contact.id, contact]));

  const add = (accountId: string | null | undefined, contact: LinkedAccountContact | undefined) => {
    if (!accountId || !contact || !buckets[accountId]) return;
    buckets[accountId].set(contact.id, contact);
  };

  allContacts.forEach((contact) => {
    if (contact.account_id && buckets[contact.account_id]) add(contact.account_id, contact);
  });

  const stakeholdersByDeal = new Map<string, string[]>();
  const sourceCampaignContactIds = unique(deals.map((deal) => deal.source_campaign_contact_id));
  const sourceCampaignContactsById = new Map<string, string>();

  if (sourceCampaignContactIds.length > 0) {
    for (const idsChunk of chunk(sourceCampaignContactIds, ID_CHUNK)) {
      const { data: campaignContacts, error: campaignContactsError } = await supabase
        .from("campaign_contacts")
        .select("id, contact_id")
        .in("id", idsChunk);
      if (campaignContactsError) throw campaignContactsError;
      (campaignContacts || []).forEach((row: any) => {
        if (row.id && row.contact_id) sourceCampaignContactsById.set(row.id, row.contact_id);
      });
    }
  }

  if (dealIds.length > 0) {
    for (const idsChunk of chunk(dealIds, ID_CHUNK)) {
      const { data: stakeholders, error: stakeholdersError } = await supabase
        .from("deal_stakeholders")
        .select("deal_id, contact_id")
        .in("deal_id", idsChunk);
      if (stakeholdersError) throw stakeholdersError;
      (stakeholders || []).forEach((row: any) => {
        if (!row.deal_id || !row.contact_id) return;
        if (!stakeholdersByDeal.has(row.deal_id)) stakeholdersByDeal.set(row.deal_id, []);
        stakeholdersByDeal.get(row.deal_id)!.push(row.contact_id);
      });
    }
  }

  deals.forEach((deal) => {
    const accountId = deal.account_id!;
    const account = accountById.get(accountId);
    const accountName = account?.account_name;
    const companyTargets = unique([accountName, deal.customer_name].filter((name) => !isMissingName(name)) as string[]);

    DEAL_CONTACT_FIELDS.forEach((field) => add(accountId, contactsById.get(deal[field] || "")));
    add(accountId, contactsById.get(sourceCampaignContactsById.get(deal.source_campaign_contact_id || "") || ""));
    (stakeholdersByDeal.get(deal.id) || []).forEach((contactId) => add(accountId, contactsById.get(contactId)));

    allContacts.forEach((contact) => {
      if (namesMatch(contact.contact_name, deal.lead_name)) add(accountId, contact);
      if (companyTargets.some((target) => companiesMatch(contact.company_name, target))) add(accountId, contact);
    });
  });

  return Object.fromEntries(
    Object.entries(buckets).map(([accountId, contacts]) => [
      accountId,
      [...contacts.values()].sort((a, b) => (a.contact_name || "").localeCompare(b.contact_name || "")),
    ])
  );
};

export const getAccountLinkedContactCounts = async (accounts: AccountLinkTarget[]) => {
  const linkedContacts = await getAccountLinkedContacts(accounts);
  return Object.fromEntries(
    Object.entries(linkedContacts).map(([accountId, contacts]) => [accountId, contacts.length])
  ) as Record<string, number>;
};