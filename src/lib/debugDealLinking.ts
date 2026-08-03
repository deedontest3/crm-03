import { supabase } from "@/integrations/supabase/client";
import {
  companiesMatch,
  fetchAllAccountsForLinking,
  fetchAllContactsForLinking,
  fetchAllDealsForLinking,
  fetchCampaignContactLinks,
  fetchDealStakeholderLinks,
  normalize,
} from "./dealLinkMatching";
import { resolveDealAccountLink } from "./accountLinkedDeals";

/**
 * Dev-only diagnostic: explains why a deal does (or doesn't) attach to an account.
 * Usage in browser console:
 *   await window.__debugDealLink("HCP & BSW Integration")
 */
export const debugDealLink = async (projectNameQuery: string) => {
  // eslint-disable-next-line no-console
  const log = (...args: unknown[]) => console.log("[debugDealLink]", ...args);

  const { data: dealRows, error: dealErr } = await supabase
    .from("deals")
    .select("*")
    .ilike("project_name", `%${projectNameQuery}%`)
    .limit(5);
  if (dealErr) {
    log("error fetching deal:", dealErr);
    return;
  }
  if (!dealRows || dealRows.length === 0) {
    log(`no deal found for project_name ilike %${projectNameQuery}%`);
    return;
  }

  const [allDeals, allContacts, allAccounts] = await Promise.all([
    fetchAllDealsForLinking(),
    fetchAllContactsForLinking(),
    fetchAllAccountsForLinking(),
  ]);
  const [stakeholderLinks, campaignContactLinks] = await Promise.all([
    fetchDealStakeholderLinks(allDeals.map((d) => d.id)),
    fetchCampaignContactLinks(allDeals.map((d) => d.source_campaign_contact_id)),
  ]);

  const contactsById = new Map(allContacts.map((c) => [c.id, c]));
  const stakeholderByDeal = new Map<string, string[]>();
  stakeholderLinks.forEach((link) => {
    if (!link.deal_id || !link.contact_id) return;
    stakeholderByDeal.set(link.deal_id, [
      ...(stakeholderByDeal.get(link.deal_id) || []),
      link.contact_id,
    ]);
  });
  const campaignContactById = new Map(campaignContactLinks.map((link) => [link.id, link]));
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));

  for (const dealRow of dealRows) {
    const matched = allDeals.find((d) => d.id === dealRow.id);
    if (!matched) {
      log(`deal ${dealRow.id} not present in fetchAllDealsForLinking() — RLS or filter mismatch`);
      continue;
    }

    log("──────────────────────────────────────────");
    log("deal:", {
      id: matched.id,
      project_name: matched.project_name,
      customer_name: matched.customer_name,
      lead_name: matched.lead_name,
      account_id: matched.account_id,
      source_campaign_contact_id: matched.source_campaign_contact_id,
    });

    if (matched.account_id) {
      const linkedAccount = accountById.get(matched.account_id);
      log("deal.account_id resolves to:", linkedAccount
        ? { id: linkedAccount.id, account_name: linkedAccount.account_name }
        : "ACCOUNT NOT FOUND in fetchAllAccountsForLinking()");
    }

    const resolution = resolveDealAccountLink(
      matched,
      contactsById,
      stakeholderByDeal,
      campaignContactById.get(matched.source_campaign_contact_id || ""),
      allAccounts
    );
    log("resolution:", resolution);
    if (resolution.status === "linked") {
      log("→ bucketed under:", {
        id: resolution.accountId,
        account_name: accountById.get(resolution.accountId)?.account_name,
      });
    }
    if (resolution.status === "ambiguous") {
      log(
        "→ ambiguous candidates:",
        resolution.accountIds.map((id) => ({
          id,
          account_name: accountById.get(id)?.account_name,
        }))
      );
    }

    // List every account whose name shares a token with the deal's customer/lead name.
    const probe = normalize(matched.customer_name || matched.lead_name || "");
    const probeTokens = probe.split(" ").filter((t) => t.length >= 3);
    const similar = allAccounts
      .filter((a) => {
        const n = normalize(a.account_name);
        return probeTokens.some((t) => n.includes(t));
      })
      .map((a) => ({
        id: a.id,
        account_name: a.account_name,
        companiesMatch_vs_customer: companiesMatch(matched.customer_name, a.account_name),
        companiesMatch_vs_lead: companiesMatch(matched.lead_name, a.account_name),
        normalize_eq_customer: normalize(a.account_name) === normalize(matched.customer_name),
      }));
    log(`accounts sharing a token with "${probe}":`);
    // eslint-disable-next-line no-console
    console.table(similar);
  }
};

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as { __debugDealLink?: typeof debugDealLink }).__debugDealLink = debugDealLink;
}

export type AccountLinkDiagnosticDeal = {
  id: string;
  project_name: string | null;
  customer_name: string | null;
  lead_name: string | null;
  account_id: string | null;
  current_account_name: string | null;
  resolution_status: "linked" | "ambiguous" | "unmatched";
  resolution_reason: string;
  bucketed_account_id: string | null;
  bucketed_account_name: string | null;
  candidate_account_ids: string[];
  candidate_account_names: string[];
  cause:
    | "saved_to_different_account"
    | "no_account_id_ambiguous"
    | "no_account_id_unmatched"
    | "orphan_account_id"
    | "unrelated";
};

export type AccountLinkDiagnostic = {
  target: { id: string; account_name: string | null };
  duplicateAccounts: { id: string; account_name: string | null }[];
  candidateDeals: AccountLinkDiagnosticDeal[];
};

/**
 * Structured diagnostic: explains why deals don't bucket under a given account.
 * Used by LinkedDealsDialog's "Diagnose" panel.
 */
export const diagnoseAccountLink = async (
  accountId: string,
  accountName: string | null
): Promise<AccountLinkDiagnostic> => {
  const [allDeals, allContacts, allAccounts] = await Promise.all([
    fetchAllDealsForLinking(),
    fetchAllContactsForLinking(),
    fetchAllAccountsForLinking(),
  ]);
  const [stakeholderLinks, campaignContactLinks] = await Promise.all([
    fetchDealStakeholderLinks(allDeals.map((d) => d.id)),
    fetchCampaignContactLinks(allDeals.map((d) => d.source_campaign_contact_id)),
  ]);

  const contactsById = new Map(allContacts.map((c) => [c.id, c]));
  const stakeholderByDeal = new Map<string, string[]>();
  stakeholderLinks.forEach((link) => {
    if (!link.deal_id || !link.contact_id) return;
    stakeholderByDeal.set(link.deal_id, [
      ...(stakeholderByDeal.get(link.deal_id) || []),
      link.contact_id,
    ]);
  });
  const campaignContactById = new Map(campaignContactLinks.map((link) => [link.id, link]));
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));

  const targetNorm = normalize(accountName);
  const targetTokens = targetNorm.split(" ").filter((t) => t.length >= 3);

  // Duplicate / sibling accounts sharing a significant token
  const duplicateAccounts = allAccounts
    .filter((a) => {
      if (a.id === accountId) return false;
      const n = normalize(a.account_name);
      return targetTokens.some((t) => n.includes(t));
    })
    .map((a) => ({ id: a.id, account_name: a.account_name }));

  // Contacts attached to the target account — used to find deals via lead_name
  const targetContactNames = new Set(
    allContacts
      .filter((c) => c.account_id === accountId)
      .map((c) => normalize(c.contact_name))
      .filter(Boolean)
  );

  const candidateDeals: AccountLinkDiagnosticDeal[] = [];
  for (const deal of allDeals) {
    const dealCustomerNorm = normalize(deal.customer_name);
    const dealLeadNorm = normalize(deal.lead_name);
    const customerHit =
      dealCustomerNorm &&
      (companiesMatch(deal.customer_name, accountName) ||
        targetTokens.some((t) => dealCustomerNorm.includes(t)));
    const leadHit = dealLeadNorm && targetContactNames.has(dealLeadNorm);
    const fkHit = deal.account_id === accountId;
    const fkPointsElsewhere =
      deal.account_id &&
      deal.account_id !== accountId &&
      duplicateAccounts.some((d) => d.id === deal.account_id);

    if (!customerHit && !leadHit && !fkHit && !fkPointsElsewhere) continue;
    // Skip deals that already bucket under this account — they are not the problem.
    if (fkHit) continue;

    const resolution = resolveDealAccountLink(
      deal,
      contactsById,
      stakeholderByDeal,
      campaignContactById.get(deal.source_campaign_contact_id || ""),
      allAccounts
    );

    const bucketedAccountId =
      resolution.status === "linked" ? resolution.accountId : null;
    const candidateIds =
      resolution.status === "ambiguous" ? resolution.accountIds : [];

    let cause: AccountLinkDiagnosticDeal["cause"] = "unrelated";
    if (deal.account_id && deal.account_id !== accountId) {
      cause = accountById.has(deal.account_id)
        ? "saved_to_different_account"
        : "orphan_account_id";
    } else if (!deal.account_id) {
      cause =
        resolution.status === "ambiguous"
          ? "no_account_id_ambiguous"
          : "no_account_id_unmatched";
    }

    candidateDeals.push({
      id: deal.id,
      project_name: deal.project_name,
      customer_name: deal.customer_name,
      lead_name: deal.lead_name,
      account_id: deal.account_id,
      current_account_name: deal.account_id
        ? accountById.get(deal.account_id)?.account_name ?? null
        : null,
      resolution_status: resolution.status,
      resolution_reason: resolution.reason,
      bucketed_account_id: bucketedAccountId,
      bucketed_account_name: bucketedAccountId
        ? accountById.get(bucketedAccountId)?.account_name ?? null
        : null,
      candidate_account_ids: candidateIds,
      candidate_account_names: candidateIds.map(
        (id) => accountById.get(id)?.account_name ?? id
      ),
      cause,
    });
  }

  return {
    target: { id: accountId, account_name: accountName },
    duplicateAccounts,
    candidateDeals,
  };
};
