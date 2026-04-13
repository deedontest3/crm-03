import { supabase } from "@/integrations/supabase/client";

// Stage rank for MAX logic
export const stageRanks: Record<string, number> = {
  "Not Contacted": 0, "Email Sent": 1, "Phone Contacted": 2,
  "LinkedIn Contacted": 3, "Responded": 4, "Qualified": 5,
};

/**
 * Derive account status from all its campaign contacts' stages
 */
export function deriveAccountStatus(contacts: { stage?: string | null }[]): string {
  if (contacts.length === 0) return "Not Contacted";
  if (contacts.some((c) => c.stage === "Qualified")) return "Deal Created";
  if (contacts.some((c) => c.stage === "Responded")) return "Responded";
  if (contacts.some((c) => c.stage !== "Not Contacted")) return "Contacted";
  return "Not Contacted";
}

/**
 * Recompute account status from DB and update campaign_accounts
 */
export async function recomputeAccountStatus(
  campaignId: string,
  accountId: string,
  queryClient: any
) {
  const { data: contacts } = await supabase
    .from("campaign_contacts")
    .select("stage")
    .eq("campaign_id", campaignId)
    .eq("account_id", accountId);
  const status = deriveAccountStatus(contacts || []);
  await supabase
    .from("campaign_accounts")
    .update({ status })
    .eq("campaign_id", campaignId)
    .eq("account_id", accountId);
  queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
}

/**
 * Parse a JSON string into an array of strings, with fallback
 */
export function parseJsonArr(text: string | null): string[] {
  if (!text) return [];
  try {
    const a = JSON.parse(text);
    return Array.isArray(a) ? a : [text];
  } catch {
    return text ? text.split("\n").filter(Boolean) : [];
  }
}

/**
 * Parse objection handling JSON: array of { objection, response }
 */
export function parseObjectionArray(text: string | null): { objection: string; response: string }[] {
  if (!text) return [];
  try {
    const a = JSON.parse(text);
    if (Array.isArray(a)) return a;
    return [];
  } catch {
    return [];
  }
}
