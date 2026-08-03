// Unified link fetchers for the Accounts Cleanup dialog.
// Handles all four link types: contacts, deals, campaigns, action items.
//
// Contacts + deals reuse the existing linked-* libraries (they include the
// fuzzy company-name matching used everywhere else in the app). Campaigns are
// resolved via `campaign_accounts` and action items via `action_items` with
// module_type='accounts' plus the deal-scoped `deal_action_items` for each
// linked deal.

import { supabase } from "@/integrations/supabase/client";
import { getAccountLinkedContacts, type AccountLinkTarget, type LinkedAccountContact } from "./accountLinkedContacts";
import { getAccountLinkedDeals } from "./accountLinkedDeals";
import type { LinkedDeal } from "./dealLinkMatching";

export type { AccountLinkTarget, LinkedAccountContact, LinkedDeal };

export interface LinkedCampaign {
  id: string;
  campaign_name: string | null;
  status: string | null;
  campaign_type: string | null;
  campaign_account_id: string; // row id in campaign_accounts (for repoint/dedupe)
}

export interface LinkedActionItem {
  id: string;
  title: string | null;
  status: string | null;
  due_date: string | null;
  module_type: string;
  module_id: string;
  source: "account" | "deal";
  deal_id?: string | null;
}

export interface LinkedAccountLead {
  id: string;
  lead_name?: string | null;
  email?: string | null;
  lead_status?: string | null;
}

export interface LinkedAccountCampaignContact {
  id: string;
  contact_id?: string | null;
  contact_name?: string | null;
  campaign_id?: string | null;
  stage?: string | null;
}

export interface AccountLinkBundle {
  contacts: LinkedAccountContact[];
  deals: LinkedDeal[];
  campaigns: LinkedCampaign[];
  actionItems: LinkedActionItem[];
}

export interface AccountLinkCounts {
  contacts: number;
  deals: number;
  campaigns: number;
  actionItems: number;
  leads: number;
  campaignContacts: number;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const ID_CHUNK = 100;

export const getAccountLinkedCampaigns = async (
  accountIds: string[]
): Promise<Record<string, LinkedCampaign[]>> => {
  const buckets: Record<string, LinkedCampaign[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (!accountIds.length) return buckets;
  const campIds = new Set<string>();
  const links: Array<{ id: string; account_id: string; campaign_id: string }> = [];
  for (const ids of chunk(accountIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("campaign_accounts")
      .select("id, account_id, campaign_id")
      .in("account_id", ids);
    if (error) throw error;
    for (const r of (data || []) as any[]) {
      if (!r.account_id || !r.campaign_id) continue;
      links.push(r);
      campIds.add(r.campaign_id);
    }
  }
  const campById = new Map<string, { id: string; campaign_name: string | null; status: string | null; campaign_type: string | null }>();
  for (const ids of chunk([...campIds], ID_CHUNK)) {
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, campaign_name, status, campaign_type")
      .in("id", ids);
    if (error) throw error;
    for (const c of (data || []) as any[]) campById.set(c.id, c);
  }
  for (const l of links) {
    const c = campById.get(l.campaign_id);
    if (!c || !buckets[l.account_id]) continue;
    buckets[l.account_id].push({ ...c, campaign_account_id: l.id });
  }
  return buckets;
};

export const getAccountLinkedActionItems = async (
  accountIds: string[],
  dealIdsByAccount: Record<string, string[]>
): Promise<Record<string, LinkedActionItem[]>> => {
  const buckets: Record<string, LinkedActionItem[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (!accountIds.length) return buckets;
  // 1. Direct account action items
  for (const ids of chunk(accountIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("action_items")
      .select("id, title, status, due_date, module_type, module_id")
      .eq("module_type", "accounts")
      .in("module_id", ids)
      .is("archived_at", null);
    if (error) throw error;
    for (const a of (data || []) as any[]) {
      if (!buckets[a.module_id]) continue;
      buckets[a.module_id].push({
        id: a.id, title: a.title, status: a.status, due_date: a.due_date,
        module_type: a.module_type, module_id: a.module_id, source: "account",
      });
    }
  }
  // 2. Deal-scoped action items for this account's deals
  const allDealIds = Array.from(new Set(Object.values(dealIdsByAccount).flat()));
  const dealToAccount = new Map<string, string>();
  for (const [accountId, dealIds] of Object.entries(dealIdsByAccount)) {
    for (const d of dealIds) dealToAccount.set(d, accountId);
  }
  for (const ids of chunk(allDealIds, ID_CHUNK)) {
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("deal_action_items")
      .select("id, deal_id, next_action, status, due_date")
      .in("deal_id", ids);
    if (error) throw error;
    for (const a of (data || []) as any[]) {
      const acc = dealToAccount.get(a.deal_id);
      if (!acc || !buckets[acc]) continue;
      buckets[acc].push({
        id: a.id, title: a.next_action, status: a.status, due_date: a.due_date,
        module_type: "deals", module_id: a.deal_id, source: "deal", deal_id: a.deal_id,
      });
    }
  }
  return buckets;
};

/**
 * Preload full link bundle counts for every account the cleanup dialog knows
 * about. Contacts + deals also return the actual records because the fuzzy
 * name-matching pass is expensive; we cache them for the drill-down.
 */
export const preloadAccountLinks = async (
  targets: AccountLinkTarget[]
): Promise<{
  counts: Record<string, AccountLinkCounts>;
  contactsByAccount: Record<string, LinkedAccountContact[]>;
  dealsByAccount: Record<string, LinkedDeal[]>;
  campaignsByAccount: Record<string, LinkedCampaign[]>;
  actionsByAccount: Record<string, LinkedActionItem[]>;
  leadsByAccount: Record<string, LinkedAccountLead[]>;
  campaignContactsByAccount: Record<string, LinkedAccountCampaignContact[]>;
}> => {
  const ids = targets.map((t) => t.id);
  const [contactsByAccount, dealsByAccount] = await Promise.all([
    getAccountLinkedContacts(targets),
    getAccountLinkedDeals(targets),
  ]);
  const dealIdsByAccount: Record<string, string[]> = {};
  for (const id of ids) dealIdsByAccount[id] = (dealsByAccount[id] || []).map((d) => d.id);
  const [campaignsByAccount, actionsByAccount, leadsByAccount, campaignContactsByAccount] = await Promise.all([
    getAccountLinkedCampaigns(ids),
    getAccountLinkedActionItems(ids, dealIdsByAccount),
    getAccountLeadsByAccount(ids),
    getAccountCampaignContactsByAccount(ids),
  ]);
  const counts: Record<string, AccountLinkCounts> = {};
  for (const id of ids) {
    counts[id] = {
      contacts: (contactsByAccount[id] || []).length,
      deals: (dealsByAccount[id] || []).length,
      campaigns: (campaignsByAccount[id] || []).length,
      actionItems: (actionsByAccount[id] || []).length,
      leads: (leadsByAccount[id] || []).length,
      campaignContacts: (campaignContactsByAccount[id] || []).length,
    };
  }
  return { counts, contactsByAccount, dealsByAccount, campaignsByAccount, actionsByAccount, leadsByAccount, campaignContactsByAccount };
};

async function getAccountLeadsByAccount(accountIds: string[]): Promise<Record<string, LinkedAccountLead[]>> {
  const out: Record<string, LinkedAccountLead[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (!accountIds.length) return out;
  for (const ids of chunk(accountIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, account_id, lead_name, email, lead_status")
      .in("account_id", ids);
    if (error) throw error;
    for (const r of (data || []) as any[]) {
      if (!r.account_id || !out[r.account_id]) continue;
      out[r.account_id].push({
        id: r.id, lead_name: r.lead_name, email: r.email, lead_status: r.lead_status,
      });
    }
  }
  return out;
}

async function getAccountCampaignContactsByAccount(
  accountIds: string[],
): Promise<Record<string, LinkedAccountCampaignContact[]>> {
  const out: Record<string, LinkedAccountCampaignContact[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (!accountIds.length) return out;
  const rows: Array<{ id: string; account_id: string; contact_id: string | null; campaign_id: string | null; stage: string | null }> = [];
  for (const ids of chunk(accountIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("campaign_contacts")
      .select("id, account_id, contact_id, campaign_id, stage")
      .in("account_id", ids);
    if (error) throw error;
    for (const r of (data || []) as any[]) {
      if (!r.account_id || !out[r.account_id]) continue;
      rows.push(r);
    }
  }
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter((v): v is string => !!v)));
  const nameById = new Map<string, string>();
  for (const ids of chunk(contactIds, ID_CHUNK)) {
    if (!ids.length) continue;
    const { data, error } = await supabase.from("contacts").select("id, contact_name").in("id", ids);
    if (error) throw error;
    for (const c of (data || []) as any[]) nameById.set(c.id, c.contact_name || "");
  }
  for (const r of rows) {
    out[r.account_id].push({
      id: r.id,
      contact_id: r.contact_id,
      contact_name: r.contact_id ? nameById.get(r.contact_id) || null : null,
      campaign_id: r.campaign_id,
      stage: r.stage,
    });
  }
  return out;
}

/**
 * Repoint every incoming link from `loserId` (loser account) onto
 * `survivorId` in a merge. Runs sequentially and reports per-type outcome.
 * Includes contact/deal name repointing so name-only links follow the merge.
 */
export const repointAccountLinks = async (opts: {
  loserId: string;
  loserName: string;
  survivorId: string;
  survivorName: string;
}) => {
  const { loserId, loserName, survivorId, survivorName } = opts;
  const results: Record<string, number> = {
    contacts: 0, deals: 0, campaigns: 0, actionItems: 0, campaignsDropped: 0,
    leads: 0, campaignContacts: 0, campaignCommunications: 0,
  };

  // Only overwrite denormalized name columns (deals.customer_name /
  // contacts.company_name) when the current value is empty or already mirrors
  // the loser's name. Rows that legitimately store a different name (e.g. a
  // subsidiary) must be preserved.
  const norm = (s: string | null | undefined) =>
    (s || "").trim().toLowerCase();
  const loserNorm = norm(loserName);
  const repointDeals = async () => {
    const { data, error } = await supabase
      .from("deals")
      .select("id, customer_name")
      .eq("account_id", loserId);
    if (error) throw error;
    if (!data?.length) return { count: 0 };
    const toRenameIds: string[] = [];
    const keepIds: string[] = [];
    for (const d of data as any[]) {
      const cn = norm(d.customer_name);
      if (!cn || cn === loserNorm) toRenameIds.push(d.id);
      else keepIds.push(d.id);
    }
    if (toRenameIds.length) {
      const { error: e1 } = await supabase.from("deals")
        .update({ account_id: survivorId, customer_name: survivorName })
        .in("id", toRenameIds);
      if (e1) throw e1;
    }
    if (keepIds.length) {
      const { error: e2 } = await supabase.from("deals")
        .update({ account_id: survivorId })
        .in("id", keepIds);
      if (e2) throw e2;
    }
    return { count: toRenameIds.length + keepIds.length };
  };
  const repointContacts = async () => {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name")
      .eq("account_id", loserId);
    if (error) throw error;
    if (!data?.length) return { count: 0 };
    const toRenameIds: string[] = [];
    const keepIds: string[] = [];
    for (const c of data as any[]) {
      const cn = norm(c.company_name);
      if (!cn || cn === loserNorm) toRenameIds.push(c.id);
      else keepIds.push(c.id);
    }
    if (toRenameIds.length) {
      const { error: e1 } = await supabase.from("contacts")
        .update({ account_id: survivorId, company_name: survivorName })
        .in("id", toRenameIds);
      if (e1) throw e1;
    }
    if (keepIds.length) {
      const { error: e2 } = await supabase.from("contacts")
        .update({ account_id: survivorId })
        .in("id", keepIds);
      if (e2) throw e2;
    }
    return { count: toRenameIds.length + keepIds.length };
  };
  const [dealsRes, contactsRes, campaignsRes, actionsRes, leadsRes, campContactsRes, campCommsRes] = await Promise.all([
    repointDeals(),
    repointContacts(),
    (async () => {
      const { data: loserLinks, error: e1 } = await supabase
        .from("campaign_accounts")
        .select("id, campaign_id")
        .eq("account_id", loserId);
      if (e1) throw e1;
      if (!loserLinks?.length) return { repointed: 0, dropped: 0 };
      const campaignIds = loserLinks.map((l: any) => l.campaign_id);
      const { data: existing } = await supabase
        .from("campaign_accounts")
        .select("campaign_id")
        .eq("account_id", survivorId)
        .in("campaign_id", campaignIds);
      const existingSet = new Set((existing || []).map((e: any) => e.campaign_id));
      const toDelete: string[] = [];
      const toRepoint: string[] = [];
      for (const l of loserLinks as any[]) {
        if (existingSet.has(l.campaign_id)) toDelete.push(l.id);
        else toRepoint.push(l.id);
      }
      const [rp, dp] = await Promise.all([
        toRepoint.length
          ? supabase.from("campaign_accounts").update({ account_id: survivorId }).in("id", toRepoint)
          : Promise.resolve({ error: null }),
        toDelete.length
          ? supabase.from("campaign_accounts").delete().in("id", toDelete)
          : Promise.resolve({ error: null }),
      ]);
      if ((rp as any).error) throw (rp as any).error;
      if ((dp as any).error) throw (dp as any).error;
      return { repointed: toRepoint.length, dropped: toDelete.length };
    })(),
    supabase
      .from("action_items")
      .update({ module_id: survivorId })
      .eq("module_type", "accounts")
      .eq("module_id", loserId)
      .is("archived_at", null)
      .select("id", { count: "exact" }),
    supabase
      .from("leads")
      .update({ account_id: survivorId })
      .eq("account_id", loserId)
      .select("id", { count: "exact" }),
    supabase
      .from("campaign_contacts")
      .update({ account_id: survivorId })
      .eq("account_id", loserId)
      .select("id", { count: "exact" }),
    supabase
      .from("campaign_communications")
      .update({ account_id: survivorId })
      .eq("account_id", loserId)
      .select("id", { count: "exact" }),
  ]);

  if ((actionsRes as any).error) throw (actionsRes as any).error;
  if ((leadsRes as any).error) throw (leadsRes as any).error;
  if ((campContactsRes as any).error) throw (campContactsRes as any).error;
  if ((campCommsRes as any).error) throw (campCommsRes as any).error;

  results.deals = (dealsRes as any).count ?? 0;
  results.contacts = (contactsRes as any).count ?? 0;
  results.campaigns = campaignsRes.repointed;
  results.campaignsDropped = campaignsRes.dropped;
  results.actionItems = (actionsRes as any).count ?? (actionsRes as any).data?.length ?? 0;
  results.leads = (leadsRes as any).count ?? (leadsRes as any).data?.length ?? 0;
  results.campaignContacts = (campContactsRes as any).count ?? (campContactsRes as any).data?.length ?? 0;
  results.campaignCommunications = (campCommsRes as any).count ?? (campCommsRes as any).data?.length ?? 0;

  return results;
};

/**
 * Run `worker` over `items` with a bounded concurrency window.
 * Keeps the browser from opening dozens of parallel Supabase connections
 * while still going far faster than a serial loop.
 */
export const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const total = items.length;
  const runners = Array.from({ length: Math.min(limit, total) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      results[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, total);
    }
  });
  await Promise.all(runners);
  return results;
};