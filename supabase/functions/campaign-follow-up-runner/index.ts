import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Subtract N business days (Mon–Fri only) from "now"
function businessDaysAgo(n: number): Date {
  const d = new Date();
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

interface Rule {
  id: string;
  campaign_id: string;
  template_id: string | null;
  wait_business_days: number;
  max_attempts: number;
  is_enabled: boolean;
  created_by: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: rules, error: rulesErr } = await supabase
      .from("campaign_follow_up_rules")
      .select("id, campaign_id, template_id, wait_business_days, max_attempts, is_enabled, created_by")
      .eq("is_enabled", true);

    if (rulesErr) throw rulesErr;

    let queued = 0;
    let skipped = 0;

    for (const rule of (rules || []) as Rule[]) {
      if (!rule.template_id) { skipped++; continue; }

      const cutoff = businessDaysAgo(rule.wait_business_days).toISOString();

      // Find candidate parent emails older than cutoff with no reply yet
      const { data: parents } = await supabase
        .from("campaign_communications")
        .select("id, contact_id, account_id, subject, body, conversation_id, internet_message_id, follow_up_attempt")
        .eq("campaign_id", rule.campaign_id)
        .eq("communication_type", "Email")
        .eq("delivery_status", "sent")
        .lt("communication_date", cutoff)
        .lt("follow_up_attempt", rule.max_attempts);

      if (!parents || parents.length === 0) continue;

      // Load template
      const { data: template } = await supabase
        .from("campaign_email_templates")
        .select("subject, body")
        .eq("id", rule.template_id)
        .maybeSingle();

      if (!template) { skipped++; continue; }

      for (const parent of parents) {
        // Skip if any inbound reply exists in this conversation
        if (parent.conversation_id) {
          const { count: replyCount } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", rule.campaign_id)
            .eq("conversation_id", parent.conversation_id)
            .eq("delivery_status", "received");
          if ((replyCount ?? 0) > 0) continue;
        }

        // Skip if a follow-up already exists for this parent
        const { count: existing } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("follow_up_parent_id", parent.id);
        if ((existing ?? 0) > 0) continue;

        // Resolve recipient email
        if (!parent.contact_id) continue;
        const { data: contact } = await supabase
          .from("contacts")
          .select("email, contact_name")
          .eq("id", parent.contact_id)
          .maybeSingle();
        if (!contact?.email) continue;

        // Build a service-role JWT-like call: invoke send-campaign-email as the rule creator.
        // We can't easily mint a user JWT here, so we'll insert a "queued" comm row that the
        // sender can pick up — OR call send-campaign-email with the service-role token.
        // For minimal coupling, mark the parent attempt count & insert a draft follow-up row
        // pointing to the same conversation so a future scheduled sender can dispatch it.
        const { error: insertErr } = await supabase
          .from("campaign_communications")
          .insert({
            campaign_id: rule.campaign_id,
            contact_id: parent.contact_id,
            account_id: parent.account_id,
            communication_type: "Email",
            subject: template.subject || `Following up: ${parent.subject || ""}`,
            body: template.body || "",
            email_status: "Queued",
            delivery_status: "pending",
            sent_via: "follow_up_automation",
            template_id: rule.template_id,
            conversation_id: parent.conversation_id,
            follow_up_parent_id: parent.id,
            follow_up_attempt: (parent.follow_up_attempt || 0) + 1,
            owner: rule.created_by,
            created_by: rule.created_by,
            communication_date: new Date().toISOString(),
            notes: `Auto-queued by follow-up rule ${rule.id} (waited ${rule.wait_business_days} business days, no reply).`,
          });

        if (insertErr) {
          console.error("Failed to queue follow-up:", insertErr);
          continue;
        }

        // Bump parent attempt counter
        await supabase
          .from("campaign_communications")
          .update({ follow_up_attempt: (parent.follow_up_attempt || 0) + 1 })
          .eq("id", parent.id);

        queued++;
      }
    }

    return new Response(JSON.stringify({ success: true, queued, skipped, rules_processed: (rules || []).length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("campaign-follow-up-runner error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
