import {
  companiesMatch,
  fetchAllAccountsForLinking,
  fetchAllContactsForLinking,
  fetchAllDealsForLinking,
  fetchCampaignContactLinks,
  fetchDealStakeholderLinks,
  getDealDirectContactIds,
  normalize,
  sortDeals,
  unique,
  type AccountLinkTarget,
  type CampaignContactLink,
  type DealStakeholderLink,
  type LinkableAccount,
  type LinkableContact,
  type LinkedDeal,
} from "./dealLinkMatching";
import { supabase } from "@/integrations/supabase/client";

export type { AccountLinkTarget, LinkedDeal } from "./dealLinkMatching";

export type DealAccountLinkResolution =
  | {
      status: "linked";
      accountId: string;
      reason:
        | "deal_account"
        | "campaign_contact_account"
        | "contact_account"
        | "name_match"
        | "name_match_exact";
    }
  | {
      status: "ambiguous";
      accountIds: string[];
      reason: "multiple_contact_accounts" | "multiple_name_matches";
    }
  | { status: "unmatched"; reason: "no_account_id" };


export type ReviewableDealLink = LinkedDeal & {
  link_status: "unmatched" | "ambiguous";
  candidate_account_ids: string[];
  candidate_account_names: string[];
};

const addDeal = (
  buckets: Record<string, Map<string, LinkedDeal>>,
  accountId: string | null | undefined,
  deal: LinkedDeal
) => {
  if (!accountId || !buckets[accountId]) return;
  buckets[accountId].set(deal.id, deal);
};

const buildStakeholderContactIdsByDeal = (stakeholderLinks: DealStakeholderLink[]) => {
  const byDeal = new Map<string, string[]>();
  stakeholderLinks.forEach((link) => {
    if (!link.deal_id || !link.contact_id) return;
    byDeal.set(link.deal_id, [...(byDeal.get(link.deal_id) || []), link.contact_id]);
  });
  return byDeal;
};

const getContactAccountIdsForDeal = (
  deal: LinkedDeal,
  contactsById: Map<string, LinkableContact>,
  stakeholderContactIdsByDeal: Map<string, string[]>,
  campaignContact?: CampaignContactLink
) => {
  const contactIds = unique([
    campaignContact?.contact_id,
    ...getDealDirectContactIds(deal),
    ...(stakeholderContactIdsByDeal.get(deal.id) || []),
  ]);

  return unique(contactIds.map((contactId) => contactsById.get(contactId)?.account_id));
};

const findNameMatchedAccountIds = (
  deal: LinkedDeal,
  nameMatchAccounts: LinkableAccount[]
): { candidates: string[]; matchedName: string | null } => {
  if (nameMatchAccounts.length === 0) return { candidates: [], matchedName: null };
  // Union candidates from BOTH customer_name and lead_name. The previous
  // early-return-on-first-hit lost legitimate lead_name matches whenever
  // customer_name produced a (wrong) fuzzy hit.
  const candidates: string[] = [];
  let matchedName: string | null = null;
  for (const name of [deal.customer_name, deal.lead_name]) {
    if (!name) continue;
    for (const account of nameMatchAccounts) {
      if (!account.account_name) continue;
      if (companiesMatch(name, account.account_name)) {
        if (!candidates.includes(account.id)) candidates.push(account.id);
        if (!matchedName) matchedName = name;
      }
    }
  }
  return { candidates, matchedName };
};

// When companiesMatch returns multiple candidates (e.g. "Magna International, Germany"
// vs "Magna International, USA" — both collapse to "magna international" after
// generic-suffix stripping), prefer the one whose raw normalized account_name
// equals the raw normalized deal name. This rescues the obvious "exact" pick
// without weakening companiesMatch elsewhere.
const pickExactNormalizedAccountId = (
  candidateIds: string[],
  matchedName: string,
  nameMatchAccounts: LinkableAccount[]
): string | null => {
  const target = normalize(matchedName);
  if (!target) return null;
  const exact = nameMatchAccounts.filter(
    (account) => candidateIds.includes(account.id) && normalize(account.account_name) === target
  );
  return exact.length === 1 ? exact[0].id : null;
};

export const resolveDealAccountLink = (
  deal: LinkedDeal,
  contactsById: Map<string, LinkableContact>,
  stakeholderContactIdsByDeal: Map<string, string[]>,
  campaignContact?: CampaignContactLink,
  nameMatchAccounts: LinkableAccount[] = []
): DealAccountLinkResolution => {
  if (deal.account_id) {
    return { status: "linked", accountId: deal.account_id, reason: "deal_account" };
  }

  if (campaignContact?.account_id) {
    return { status: "linked", accountId: campaignContact.account_id, reason: "campaign_contact_account" };
  }

  const contactAccountIds = getContactAccountIdsForDeal(
    deal,
    contactsById,
    stakeholderContactIdsByDeal,
    campaignContact
  );

  if (contactAccountIds.length === 1) {
    return { status: "linked", accountId: contactAccountIds[0], reason: "contact_account" };
  }

  if (contactAccountIds.length > 1) {
    return { status: "ambiguous", accountIds: contactAccountIds, reason: "multiple_contact_accounts" };
  }

  const { candidates: nameMatches, matchedName } = findNameMatchedAccountIds(deal, nameMatchAccounts);
  if (nameMatches.length === 1) {
    return { status: "linked", accountId: nameMatches[0], reason: "name_match" };
  }
  if (nameMatches.length > 1 && matchedName) {
    const exactId = pickExactNormalizedAccountId(nameMatches, matchedName, nameMatchAccounts);
    if (exactId) {
      return { status: "linked", accountId: exactId, reason: "name_match_exact" };
    }
    return { status: "ambiguous", accountIds: nameMatches, reason: "multiple_name_matches" };
  }

  return { status: "unmatched", reason: "no_account_id" };
};

export const buildAccountLinkedDealMap = (
  accounts: AccountLinkTarget[],
  deals: LinkedDeal[],
  contacts: LinkableContact[],
  stakeholderLinks: DealStakeholderLink[],
  campaignContactLinks: CampaignContactLink[],
  nameMatchAccounts?: LinkableAccount[]
): Record<string, LinkedDeal[]> => {
  const accountIds = unique(accounts.map((account) => account.id));
  const buckets: Record<string, Map<string, LinkedDeal>> = Object.fromEntries(
    accountIds.map((id) => [id, new Map<string, LinkedDeal>()])
  );

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const stakeholderContactIdsByDeal = buildStakeholderContactIdsByDeal(stakeholderLinks);
  const campaignContactById = new Map(campaignContactLinks.map((link) => [link.id, link]));
  // Default the name-match pool to the requested accounts so callers without the
  // full universe (tests, legacy callers) still get fallback resolution.
  const nameMatchPool = nameMatchAccounts ?? accounts.map((a) => ({ id: a.id, account_name: a.account_name }));

  deals.forEach((deal) => {
    const resolution = resolveDealAccountLink(
      deal,
      contactsById,
      stakeholderContactIdsByDeal,
      campaignContactById.get(deal.source_campaign_contact_id || ""),
      nameMatchPool
    );

    if (resolution.status === "linked") {
      addDeal(buckets, resolution.accountId, deal);
    }
  });

  return Object.fromEntries(
    Object.entries(buckets).map(([id, accountDeals]) => [id, sortDeals([...accountDeals.values()])])
  );
};

const fetchAccountLinkingContext = async () => {
  const [allDeals, allContacts, allAccounts] = await Promise.all([
    fetchAllDealsForLinking(),
    fetchAllContactsForLinking(),
    fetchAllAccountsForLinking(),
  ]);

  const [stakeholderLinks, campaignContactLinks] = await Promise.all([
    fetchDealStakeholderLinks(allDeals.map((deal) => deal.id)),
    fetchCampaignContactLinks(allDeals.map((deal) => deal.source_campaign_contact_id)),
  ]);

  return { allDeals, allContacts, allAccounts, stakeholderLinks, campaignContactLinks };
};

export const getAccountLinkedDeals = async (
  accounts: AccountLinkTarget[]
): Promise<Record<string, LinkedDeal[]>> => {
  const accountIds = unique(accounts.map((account) => account.id));
  if (accountIds.length === 0) return {};

  const { allDeals, allContacts, allAccounts, stakeholderLinks, campaignContactLinks } =
    await fetchAccountLinkingContext();
  return buildAccountLinkedDealMap(
    accounts,
    allDeals,
    allContacts,
    stakeholderLinks,
    campaignContactLinks,
    allAccounts
  );
};


const getReviewableDealLinks = async (status: "unmatched" | "ambiguous") => {
  const { allDeals, allContacts, allAccounts, stakeholderLinks, campaignContactLinks } =
    await fetchAccountLinkingContext();

  const contactsById = new Map(allContacts.map((contact) => [contact.id, contact]));
  const stakeholderContactIdsByDeal = buildStakeholderContactIdsByDeal(stakeholderLinks);
  const campaignContactById = new Map(campaignContactLinks.map((link) => [link.id, link]));
  const accountById = new Map((allAccounts as LinkableAccount[]).map((account) => [account.id, account]));

  return sortDeals(
    allDeals.filter((deal) => {
      const resolution = resolveDealAccountLink(
        deal,
        contactsById,
        stakeholderContactIdsByDeal,
        campaignContactById.get(deal.source_campaign_contact_id || ""),
        allAccounts
      );
      return resolution.status === status;
    })
  ).map((deal) => {
    const resolution = resolveDealAccountLink(
      deal,
      contactsById,
      stakeholderContactIdsByDeal,
      campaignContactById.get(deal.source_campaign_contact_id || ""),
      allAccounts
    );
    const candidateIds = resolution.status === "ambiguous" ? resolution.accountIds : [];
    return {
      ...deal,
      link_status: status,
      candidate_account_ids: candidateIds,
      candidate_account_names: candidateIds.map((id) => accountById.get(id)?.account_name || id),
    } satisfies ReviewableDealLink;
  });
};


export const getUnmatchedDeals = async (): Promise<ReviewableDealLink[]> =>
  getReviewableDealLinks("unmatched");

export const getAmbiguousDealLinks = async (): Promise<ReviewableDealLink[]> =>
  getReviewableDealLinks("ambiguous");

export const updateDealAccountId = async (dealId: string, accountId: string | null) => {
  const { error } = await supabase
    .from("deals")
    .update({ account_id: accountId, modified_time: new Date().toISOString() })
    .eq("id", dealId);
  if (error) {
    // Surface the real Postgres reason (e.g. trigger validation) so the caller
    // can show it to the user instead of a generic "Failed to link deal".
    const reason = (error as { message?: string }).message || "Unknown database error";
    throw new Error(reason);
  }
};


export const getAccountLinkedDealCounts = async (
  accounts: AccountLinkTarget[]
): Promise<Record<string, number>> => {
  const linked = await getAccountLinkedDeals(accounts);
  return Object.fromEntries(
    Object.entries(linked).map(([id, deals]) => [id, deals.length])
  );
};

/**
 * Compute linked-deal counts for EVERY account in a single pass.
 *
 * The heavy `getAccountLinkedDeals` call downloads the whole linking universe
 * (all deals/contacts/accounts/stakeholders/campaign-contacts) regardless of
 * how many accounts are requested, so paging through the table and asking for
 * counts of just the visible page re-downloaded everything on every page.
 * Computing counts for all accounts once — cached by the table on refresh only —
 * removes that per-page cost entirely.
 */
export const getAllAccountDealCounts = async (): Promise<Record<string, number>> => {
  // Fast path: SECURITY DEFINER RPC computes counts in one SQL pass on the
  // server, keyed by account_id. Falls back to the legacy full-download +
  // in-browser computation only when the function isn't deployed yet.
  try {
    const { data, error } = await (supabase as any).rpc("get_account_deal_counts");
    if (!error && Array.isArray(data)) {
      const out: Record<string, number> = {};
      for (const row of data as Array<{ account_id: string; deal_count: number | string }>) {
        if (row?.account_id) out[row.account_id] = Number(row.deal_count) || 0;
      }
      return out;
    }
  } catch (e) {
    console.warn("get_account_deal_counts RPC failed; falling back to client scan", e);
  }
  const accounts = await fetchAllAccountsForLinking();
  const targets = accounts.map((account) => ({
    id: account.id,
    account_name: account.account_name || "",
  }));
  if (targets.length === 0) return {};
  const linked = await getAccountLinkedDeals(targets);
  return Object.fromEntries(
    Object.entries(linked).map(([id, deals]) => [id, deals.length])
  );
};

export const getAccountIdsWithLinkedDeals = async (): Promise<string[]> => {
  const accounts = await fetchAllAccountsForLinking();
  const linked = await getAccountLinkedDeals(
    accounts.map((account) => ({ id: account.id, account_name: account.account_name || "" }))
  );
  return Object.entries(linked)
    .filter(([, deals]) => deals.length > 0)
    .map(([accountId]) => accountId);
};
