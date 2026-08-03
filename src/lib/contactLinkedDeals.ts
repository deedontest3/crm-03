import { supabase } from "@/integrations/supabase/client";
import {
  fetchAllContactsForLinking,
  fetchAllDealsForLinking,
  fetchCampaignContactLinks,
  fetchDealStakeholderLinks,
  getDealDirectContactIds,
  isMissingName,
  namesMatch,
  normalize,
  sortDeals,
  unique,
  type ContactLinkTarget,
  type LinkableContact,
  type LinkedDeal,
} from "./dealLinkMatching";

export type { ContactLinkTarget } from "./dealLinkMatching";

const normalizeTargetInput = async (
  contacts: Array<string | ContactLinkTarget>
): Promise<ContactLinkTarget[]> => {
  const ids = unique(contacts.map((contact) => typeof contact === "string" ? contact : contact.id));
  if (ids.length === 0) return [];

  const hasMissingDetails = contacts.some((contact) =>
    typeof contact === "string" || contact.contact_name === undefined || contact.company_name === undefined
  );
  if (!hasMissingDetails) return contacts as ContactLinkTarget[];

  const { data, error } = await supabase
    .from("contacts")
    .select("id, contact_name, company_name, account_id")
    .in("id", ids);
  if (error) throw error;

  const fetchedById = new Map(((data || []) as LinkableContact[]).map((contact) => [contact.id, contact]));
  return ids.map((id) => ({ id, ...fetchedById.get(id) }));
};

const addDeal = (
  buckets: Record<string, Map<string, LinkedDeal>>,
  contactId: string | null | undefined,
  deal: LinkedDeal
) => {
  if (!contactId || !buckets[contactId]) return;
  buckets[contactId].set(deal.id, deal);
};

export interface ContactLinkedDealsContext {
  allDeals: LinkedDeal[];
  allContacts: LinkableContact[];
  stakeholderContactIdsByDeal: Map<string, string[]>;
  campaignContactById: Map<string, { id: string; contact_id: string | null; account_id: string | null }>;
  /** Contacts grouped by normalized name AND by individual name tokens — used to resolve deal.lead_name → contact(s). */
  contactsByNormalizedName?: Map<string, LinkableContact[]>;
}

const buildContactsByName = (contacts: LinkableContact[]): Map<string, LinkableContact[]> => {
  const map = new Map<string, LinkableContact[]>();
  contacts.forEach((c) => {
    const n = normalize(c.contact_name);
    if (!n) return;
    const arr = map.get(n) || [];
    arr.push(c);
    map.set(n, arr);
  });
  return map;
};

/** Resolve a deal's lead_name (free-text) to candidate contact ids.
 * - Strict normalized-name equality first (fast O(1) lookup).
 * - Falls back to fuzzy namesMatch across all contacts (handles initials, suffixes).
 * - When the deal has an account_id and any candidate shares it, restrict to those.
 */
export const resolveLeadContactIds = (
  deal: LinkedDeal,
  contactsByName: Map<string, LinkableContact[]>,
  allContacts: LinkableContact[]
): string[] => {
  if (isMissingName(deal.lead_name)) return [];
  const key = normalize(deal.lead_name);
  let candidates = contactsByName.get(key) || [];
  if (candidates.length === 0) {
    candidates = allContacts.filter((c) => namesMatch(deal.lead_name, c.contact_name));
  }
  if (candidates.length === 0) return [];
  if (deal.account_id) {
    const scoped = candidates.filter((c) => c.account_id === deal.account_id);
    if (scoped.length > 0) return scoped.map((c) => c.id);
  }
  return candidates.map((c) => c.id);
};

const fetchContactLinkingContext = async (): Promise<ContactLinkedDealsContext> => {
  const [allDeals, allContacts] = await Promise.all([
    fetchAllDealsForLinking(),
    fetchAllContactsForLinking(),
  ]);

  const [stakeholderLinks, campaignContactLinks] = await Promise.all([
    fetchDealStakeholderLinks(allDeals.map((d) => d.id)),
    fetchCampaignContactLinks(allDeals.map((d) => d.source_campaign_contact_id)),
  ]);

  const stakeholderContactIdsByDeal = new Map<string, string[]>();
  stakeholderLinks.forEach((link) => {
    if (!link.deal_id || !link.contact_id) return;
    stakeholderContactIdsByDeal.set(link.deal_id, [
      ...(stakeholderContactIdsByDeal.get(link.deal_id) || []),
      link.contact_id,
    ]);
  });

  const campaignContactById = new Map(campaignContactLinks.map((link) => [link.id, link]));
  const contactsByNormalizedName = buildContactsByName(allContacts);

  return { allDeals, allContacts, stakeholderContactIdsByDeal, campaignContactById, contactsByNormalizedName };
};

export const buildContactLinkedDealMap = (
  targets: ContactLinkTarget[],
  ctx: ContactLinkedDealsContext
): Record<string, LinkedDeal[]> => {
  const ids = unique(targets.map((t) => t.id));
  const buckets: Record<string, Map<string, LinkedDeal>> = Object.fromEntries(
    ids.map((id) => [id, new Map<string, LinkedDeal>()])
  );
  if (ids.length === 0) return {};

  const contactsByName = ctx.contactsByNormalizedName || buildContactsByName(ctx.allContacts);

  ctx.allDeals.forEach((deal) => {
    // Direct contact↔deal links:
    //   - deal direct-contact fields (budget_owner, champion, objector, influencer)
    //   - deal_stakeholders rows
    //   - campaign_contacts.contact_id for the deal's source_campaign_contact_id
    //   - deal.lead_name resolved to a contact by name (account-scoped when possible)
    // Account-membership fanout is intentionally NOT used — that would credit
    // every contact at an account with all of that account's deals.
    getDealDirectContactIds(deal).forEach((cid) => addDeal(buckets, cid, deal));
    (ctx.stakeholderContactIdsByDeal.get(deal.id) || []).forEach((cid) => addDeal(buckets, cid, deal));
    const campaignContact = ctx.campaignContactById.get(deal.source_campaign_contact_id || "");
    addDeal(buckets, campaignContact?.contact_id, deal);
    resolveLeadContactIds(deal, contactsByName, ctx.allContacts).forEach((cid) =>
      addDeal(buckets, cid, deal)
    );
  });

  return Object.fromEntries(
    Object.entries(buckets).map(([cid, m]) => [cid, sortDeals([...m.values()])])
  );
};

export const getContactLinkedDeals = async (
  contacts: Array<string | ContactLinkTarget>
): Promise<Record<string, LinkedDeal[]>> => {
  const targets = await normalizeTargetInput(contacts);
  if (targets.length === 0) return {};
  const ctx = await fetchContactLinkingContext();
  return buildContactLinkedDealMap(targets, ctx);
};

export const getContactLinkedDealCounts = async (
  contacts: Array<string | ContactLinkTarget>
): Promise<Record<string, number>> => {
  const linked = await getContactLinkedDeals(contacts);
  return Object.fromEntries(Object.entries(linked).map(([id, deals]) => [id, deals.length]));
};

export const getContactIdsWithLinkedDeals = async (): Promise<string[]> => {
  const contacts = await fetchAllContactsForLinking();
  const linked = await getContactLinkedDeals(contacts);
  return Object.entries(linked)
    .filter(([, deals]) => deals.length > 0)
    .map(([contactId]) => contactId);
};
