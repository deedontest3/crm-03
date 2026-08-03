// E11 — Automation triggers: enroll contacts into a target campaign when an
// account.status or deal.stage matches a configured value. Designed to be
// invoked on a cron tick (every 5–15 min) or via direct call.
//
// Idempotency: the (trigger_id, contact_id) UNIQUE constraint on
// campaign_automation_enrollments guarantees a contact is enrolled at most
// once per trigger, even on retries.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronSecret } from "../_shared/auth-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface Trigger {
  id: string;
  name: string;
  trigger_event: "account_status_changed" | "deal_stage_changed";
  condition: { to_value?: string; from_value?: string };
  target_campaign_id: string;
  is_enabled: boolean;
  last_run_at: string | null;
  enrolled_count: number;
  created_by: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Cron-only endpoint. Fail-closed cron gate.
  const cron = requireCronSecret(req);
  if ("response" in cron) return cron.response;


  try {

    const { data: triggers, error: tErr } = await supabase
      .from("campaign_automation_triggers")
      .select("*")
      .eq("is_enabled", true);
    if (tErr) throw tErr;

    let totalEnrolled = 0;
    let processed = 0;
    const trace: Array<Record<string, unknown>> = [];

    for (const trig of (triggers || []) as Trigger[]) {
      processed++;
      const since = trig.last_run_at
        ? new Date(trig.last_run_at)
        : new Date(Date.now() - 24 * 3600 * 1000);
      const sinceIso = since.toISOString();
      const toValue = trig.condition?.to_value;
      if (!toValue) {
        trace.push({ trigger: trig.id, skipped: "no to_value in condition" });
        continue;
      }

      let contactIds: Array<{ contact_id: string; account_id: string | null }> = [];

      if (trig.trigger_event === "account_status_changed") {
        // Accounts that currently match the target status AND were modified
        // since we last ran. Conservative: matches on current value (we don't
        // store an audit trail of every status change for accounts yet, so we
        // can't reliably detect from→to without one).
        const { data: accs, error } = await supabase
          .from("accounts")
          .select("id, status, modified_time")
          .eq("status", toValue)
          .gte("modified_time", sinceIso)
          .limit(1000);
        if (error) { trace.push({ trigger: trig.id, error: error.message }); continue; }
        // Resolve contacts for these accounts.
        const accIds = (accs || []).map(a => a.id);
        if (accIds.length === 0) {
          trace.push({ trigger: trig.id, candidates: 0 });
        } else {
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, account_id")
            .in("account_id", accIds)
            .limit(5000);
          contactIds = (contacts || []).map((c: any) => ({
            contact_id: c.id,
            account_id: c.account_id,
          }));
        }
      } else if (trig.trigger_event === "deal_stage_changed") {
        // Deals currently in the target stage AND modified since last run.
        const { data: deals, error } = await supabase
          .from("deals")
          .select("id, stage, account_id, modified_time")
          .eq("stage", toValue)
          .gte("modified_time", sinceIso)
          .limit(1000);
        if (error) { trace.push({ trigger: trig.id, error: error.message }); continue; }
        const accIds = Array.from(new Set((deals || []).map(d => d.account_id).filter(Boolean) as string[]));
        if (accIds.length === 0) {
          trace.push({ trigger: trig.id, candidates: 0 });
        } else {
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, account_id")
            .in("account_id", accIds)
            .limit(5000);
          contactIds = (contacts || []).map((c: any) => ({
            contact_id: c.id,
            account_id: c.account_id,
          }));
        }
      }

      if (contactIds.length === 0) {
        await supabase
          .from("campaign_automation_triggers")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", trig.id);
        continue;
      }

      // Enroll: bulk-check existing rows, then bulk-insert. Prior version did
      // 2 count-queries + 2 inserts per contact — O(N) round-trips.
      const cids = contactIds.map((c) => c.contact_id);
      const [{ data: existingCC }, { data: existingEnr }] = await Promise.all([
        supabase
          .from("campaign_contacts")
          .select("contact_id")
          .eq("campaign_id", trig.target_campaign_id)
          .in("contact_id", cids),
        supabase
          .from("campaign_automation_enrollments")
          .select("contact_id")
          .eq("trigger_id", trig.id)
          .in("contact_id", cids),
      ]);
      const skip = new Set<string>([
        ...(existingCC || []).map((r: any) => r.contact_id),
        ...(existingEnr || []).map((r: any) => r.contact_id),
      ]);
      const toInsert = contactIds.filter((c) => !skip.has(c.contact_id));

      let enrolledThisTrigger = 0;
      if (toInsert.length > 0) {
        const { error: ccErr } = await supabase.from("campaign_contacts").insert(
          toInsert.map(({ contact_id, account_id }) => ({
            campaign_id: trig.target_campaign_id,
            contact_id,
            account_id,
            stage: "Not Contacted",
            created_by: trig.created_by,
          })),
        );
        if (ccErr) {
          trace.push({ trigger: trig.id, error: `bulk insert campaign_contacts: ${ccErr.message}` });
        } else {
          await supabase.from("campaign_automation_enrollments").insert(
            toInsert.map(({ contact_id, account_id }) => ({
              trigger_id: trig.id,
              campaign_id: trig.target_campaign_id,
              contact_id,
              account_id,
            })),
          );
          enrolledThisTrigger = toInsert.length;
        }
      }


      await supabase
        .from("campaign_automation_triggers")
        .update({
          last_run_at: new Date().toISOString(),
          enrolled_count: trig.enrolled_count + enrolledThisTrigger,
        })
        .eq("id", trig.id);

      totalEnrolled += enrolledThisTrigger;
      trace.push({ trigger: trig.id, enrolled: enrolledThisTrigger });
    }

    return new Response(
      JSON.stringify({ success: true, processed, totalEnrolled, trace }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[process-automation-triggers] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
