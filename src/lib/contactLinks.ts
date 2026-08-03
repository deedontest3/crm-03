// Preload link counts for contacts, and repoint every incoming reference
// from a loser contact onto the survivor during a merge.
//
// Contact reference graph (verified against src/integrations/supabase/types.ts):
//   deal_stakeholders.contact_id       → deal↔contact link table
//   campaign_contacts.contact_id       → campaign membership
//   campaign_communications.contact_id → outreach log (nullable)
//   campaign_variant_assignments.contact_id → A/B test assignment
//
// Deals do NOT have direct primary/technical/commercial/decision-maker FKs;
// contact linkage is entirely through deal_stakeholders. Free-text name
// fields on deals (budget_owner, champion, etc.) are matched heuristically
// by src/lib/contactLinkedDeals.ts and are not repointed here.

import { supabase } from "@/integrations/supabase/client";
import { getContactLinkedDealCounts } from "./contactLinkedDeals";

export interface ContactLinkTarget {
  id: string;
  contact_name?: string | null;
  company_name?: string | null;
  account_id?: string | null;
}

export interface ContactLinkCounts {
  deals: number;
  campaignContacts: number;
  campaignCommunications: number;
  variantAssignments: number;
}

const ID_CHUNK = 200;
const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Group-by-count over a single column via client-side folding. */
async function countByColumn(
  table: "campaign_contacts" | "campaign_communications" | "campaign_variant_assignments",
  ids: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  for (const batch of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabase.from(table).select("contact_id").in("contact_id", batch);
    if (error) throw error;
    for (const r of (data || []) as { contact_id: string | null }[]) {
      if (!r.contact_id) continue;
      out[r.contact_id] = (out[r.contact_id] || 0) + 1;
    }
  }
  return out;
}

export const preloadContactLinks = async (
  targets: ContactLinkTarget[],
): Promise<{
  counts: Record<string, ContactLinkCounts>;
  dealCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
}> => {
  const ids = targets.map((t) => t.id);
  const [dealCounts, campaignContacts, campaignComms, variants] = await Promise.all([
    getContactLinkedDealCounts(targets),
    countByColumn("campaign_contacts", ids),
    countByColumn("campaign_communications", ids),
    countByColumn("campaign_variant_assignments", ids),
  ]);
  const counts: Record<string, ContactLinkCounts> = {};
  for (const id of ids) {
    counts[id] = {
      deals: dealCounts[id] || 0,
      campaignContacts: campaignContacts[id] || 0,
      campaignCommunications: campaignComms[id] || 0,
      variantAssignments: variants[id] || 0,
    };
  }
  const campaignCounts: Record<string, number> = {};
  // Membership count only — do NOT sum communications (an outreach log per
  // email would triple-count a single campaign link). Use campaign_contacts
  // as the canonical membership signal.
  for (const id of ids) campaignCounts[id] = counts[id].campaignContacts;
  return { counts, dealCounts, campaignCounts };
};


/** Load the set of valid account ids for orphan detection + a name lookup. */
export const loadAccountUniverse = async (): Promise<{
  validAccountIds: Set<string>;
  accountNameById: Map<string, string>;
}> => {
  const pageSize = 1000;
  let from = 0;
  const validAccountIds = new Set<string>();
  const accountNameById = new Map<string, string>();
  while (true) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, account_name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as { id: string; account_name: string | null }[]) {
      validAccountIds.add(r.id);
      accountNameById.set(r.id, r.account_name || "");
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { validAccountIds, accountNameById };
};

/**
 * Repoint every incoming link from `loserId` onto `survivorId`.
 * De-dupes stakeholder & campaign_contact rows so we never violate a
 * hypothetical (deal_id, contact_id) / (campaign_id, contact_id) uniqueness
 * expectation: if the survivor already has that link, we drop the loser's.
 */
export const repointContactLinks = async (opts: {
  loserId: string;
  survivorId: string;
}): Promise<{
  stakeholders: number; stakeholdersDropped: number;
  campaignContacts: number; campaignContactsDropped: number;
  campaignCommunications: number;
  variantAssignments: number; variantAssignmentsDropped: number;
}> => {
  const { loserId, survivorId } = opts;

  const chunkedUpdate = async (table: string, ids: string[], patch: Record<string, any>) => {
    for (const batch of chunk(ids, ID_CHUNK)) {
      const { error } = await supabase.from(table as any).update(patch).in("id", batch);
      if (error) throw error;
    }
  };
  const chunkedDelete = async (table: string, ids: string[]) => {
    for (const batch of chunk(ids, ID_CHUNK)) {
      const { error } = await supabase.from(table as any).delete().in("id", batch);
      if (error) throw error;
    }
  };

  // 1. deal_stakeholders — dedupe by (deal_id, role) against survivor's set.
  const stake = await (async () => {
    const { data: loserLinks, error } = await supabase
      .from("deal_stakeholders").select("id, deal_id, role").eq("contact_id", loserId);
    if (error) throw error;
    if (!loserLinks?.length) return { repointed: 0, dropped: 0 };
    const dealIds = Array.from(new Set(loserLinks.map((l: any) => l.deal_id)));
    const survivorLinks: any[] = [];
    for (const batch of chunk(dealIds, ID_CHUNK)) {
      const { data } = await supabase.from("deal_stakeholders")
        .select("deal_id, role").eq("contact_id", survivorId).in("deal_id", batch);
      if (data) survivorLinks.push(...data);
    }
    const has = new Set(survivorLinks.map((s: any) => `${s.deal_id}|${s.role}`));
    const toDelete: string[] = [], toRepoint: string[] = [];
    for (const l of loserLinks as any[]) {
      if (has.has(`${l.deal_id}|${l.role}`)) toDelete.push(l.id); else toRepoint.push(l.id);
    }
    if (toRepoint.length) await chunkedUpdate("deal_stakeholders", toRepoint, { contact_id: survivorId });
    if (toDelete.length) await chunkedDelete("deal_stakeholders", toDelete);
    return { repointed: toRepoint.length, dropped: toDelete.length };
  })();

  // 2. campaign_contacts — dedupe by campaign_id.
  const campC = await (async () => {
    const { data: loserLinks, error } = await supabase
      .from("campaign_contacts").select("id, campaign_id").eq("contact_id", loserId);
    if (error) throw error;
    if (!loserLinks?.length) return { repointed: 0, dropped: 0 };
    const campIds = Array.from(new Set(loserLinks.map((l: any) => l.campaign_id).filter(Boolean)));
    const survivorLinks: any[] = [];
    for (const batch of chunk(campIds, ID_CHUNK)) {
      const { data } = await supabase.from("campaign_contacts")
        .select("campaign_id").eq("contact_id", survivorId).in("campaign_id", batch);
      if (data) survivorLinks.push(...data);
    }
    const has = new Set(survivorLinks.map((s: any) => s.campaign_id));
    const toDelete: string[] = [], toRepoint: string[] = [];
    for (const l of loserLinks as any[]) {
      if (l.campaign_id && has.has(l.campaign_id)) toDelete.push(l.id); else toRepoint.push(l.id);
    }
    if (toRepoint.length) await chunkedUpdate("campaign_contacts", toRepoint, { contact_id: survivorId });
    if (toDelete.length) await chunkedDelete("campaign_contacts", toDelete);
    return { repointed: toRepoint.length, dropped: toDelete.length };
  })();

  // 3. campaign_communications — straight repoint. Get accurate count with HEAD query.
  const commsCount = await (async () => {
    const { count: preCount } = await supabase.from("campaign_communications")
      .select("id", { count: "exact", head: true }).eq("contact_id", loserId);
    const { error } = await supabase.from("campaign_communications")
      .update({ contact_id: survivorId }).eq("contact_id", loserId);
    if (error) throw error;
    return preCount ?? 0;
  })();

  // 4. campaign_variant_assignments — dedupe by (campaign_id, variant_id).
  const variantRes = await (async () => {
    const { data: loserLinks, error } = await supabase
      .from("campaign_variant_assignments")
      .select("id, campaign_id, variant_id").eq("contact_id", loserId);
    if (error) throw error;
    if (!loserLinks?.length) return { repointed: 0, dropped: 0 };
    // Chunk the survivor lookup by campaign_id to survive workspaces with
    // thousands of assignments — the previous unbounded query 500'd at scale.
    const campIds = Array.from(new Set((loserLinks as any[]).map((l) => l.campaign_id).filter(Boolean)));
    const survivorLinks: any[] = [];
    for (const batch of chunk(campIds, ID_CHUNK)) {
      const { data } = await supabase
        .from("campaign_variant_assignments")
        .select("campaign_id, variant_id")
        .eq("contact_id", survivorId)
        .in("campaign_id", batch);
      if (data) survivorLinks.push(...data);
    }
    const has = new Set(survivorLinks.map((s: any) => `${s.campaign_id}|${s.variant_id}`));
    const toDelete: string[] = [], toRepoint: string[] = [];
    for (const l of loserLinks as any[]) {
      if (has.has(`${l.campaign_id}|${l.variant_id}`)) toDelete.push(l.id); else toRepoint.push(l.id);
    }
    if (toRepoint.length) await chunkedUpdate("campaign_variant_assignments", toRepoint, { contact_id: survivorId });
    if (toDelete.length) await chunkedDelete("campaign_variant_assignments", toDelete);
    return { repointed: toRepoint.length, dropped: toDelete.length };
  })();


  return {
    stakeholders: stake.repointed,
    stakeholdersDropped: stake.dropped,
    campaignContacts: campC.repointed,
    campaignContactsDropped: campC.dropped,
    campaignCommunications: commsCount,
    variantAssignments: variantRes.repointed,
    variantAssignmentsDropped: variantRes.dropped,
  };
};

/** Concurrency-bounded worker used by bulk merge. */
export const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0, done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
};
