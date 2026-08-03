// Daily scan: notify deal owners when a deal has been in its current stage
// longer than the configured SLA in stage_sla_config.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/auth-gate.ts";

// `@supabase/supabase-js@2/cors` does not exist as a package subpath — importing
// it threw at module load, so this whole function failed on every invocation.
// Inline the CORS headers like every other function in this project.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const OPEN_STAGES = [
  "Lead",
  "Discussions",
  "Qualified",
  "RFQ",
  "Offered",
  "Negotiation",
  "Verbal Approval",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron-only endpoint. Fail-closed cron gate.
  const cron = requireCronSecret(req);
  if ("response" in cron) return cron.response;


  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: slaRows, error: slaErr } = await supabase
      .from("stage_sla_config")
      .select("stage, days");
    if (slaErr) throw slaErr;

    const slaMap = new Map<string, number>();
    (slaRows || []).forEach((r: { stage: string; days: number }) =>
      slaMap.set(r.stage, r.days),
    );

    const { data: deals, error: dealsErr } = await supabase
      .from("deals")
      .select("id, deal_name, stage, stage_entered_at, lead_owner, created_by, next_step, next_step_due_date")
      .in("stage", OPEN_STAGES);
    if (dealsErr) throw dealsErr;

    const now = Date.now();
    let inserted = 0;
    let skipped = 0;

    for (const d of deals || []) {
      const slaDays = slaMap.get(d.stage);
      const enteredMs = new Date(d.stage_entered_at).getTime();
      const ageDays = Math.floor((now - enteredMs) / 86400000);
      const slaStale = slaDays && ageDays > slaDays;

      // Next-step anchor: if a next_step_due_date is set and is in the past, the deal is stale.
      const nextDueMs = d.next_step_due_date ? new Date(d.next_step_due_date).getTime() : null;
      const nextStepOverdueDays = nextDueMs ? Math.floor((now - nextDueMs) / 86400000) : 0;
      const nextStepStale = nextDueMs !== null && nextStepOverdueDays > 0;

      if (!slaStale && !nextStepStale) continue;


      // Resolve owner user_id: try profiles.full_name match, fall back to created_by.
      let userId: string | null = null;
      if (d.lead_owner) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("full_name", d.lead_owner)
          .maybeSingle();
        if (prof?.id) userId = prof.id;
      }
      if (!userId) userId = d.created_by;
      if (!userId) {
        skipped++;
        continue;
      }

      // Dedup: any deal_stale notification for this deal since stage_entered_at?
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("module_type", "deal")
        .eq("module_id", d.id)
        .eq("notification_type", "deal_stale")
        .gte("created_at", d.stage_entered_at)
        .limit(1);
      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const reason = nextStepStale
        ? `${d.deal_name}: next step "${d.next_step ?? "(unspecified)"}" is ${nextStepOverdueDays} day(s) overdue`
        : `${d.deal_name} has been in ${d.stage} for ${ageDays} days (SLA ${slaDays})`;

      const { error: insErr } = await supabase.from("notifications").insert({
        user_id: userId,
        message: reason,
        status: "unread",
        notification_type: "deal_stale",
        module_type: "deal",
        module_id: d.id,
      });

      if (insErr) {
        console.error("insert notification failed", d.id, insErr.message);
        skipped++;
      } else {
        inserted++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scanned: deals?.length ?? 0, inserted, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("deal-stale-scan error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
