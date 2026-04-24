import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAzureEmailConfig, getGraphAccessToken, sendEmailViaGraph } from "../_shared/azure-email.ts";

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

function plainToHtml(body: string): string {
  if (/<(p|div|br|table|ul|ol|h[1-6]|blockquote)\b/i.test(body)) return body;
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const blocks = escaped.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((b) => `<p style="margin:0 0 1em 0; line-height:1.5;">${b.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("MY_SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // SAFETY GATE: only dispatch when an admin has explicitly turned automation on.
    const { data: settingRow } = await supabase
      .from("campaign_settings")
      .select("setting_value")
      .eq("setting_key", "follow_ups_enabled")
      .maybeSingle();
    const automationOn = (settingRow?.setting_value || "false").toLowerCase() === "true";

    if (!automationOn) {
      return new Response(JSON.stringify({
        success: true,
        skipped_reason: "follow_ups_enabled flag is OFF in campaign_settings",
        sent: 0,
        rules_processed: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const azureConfig = getAzureEmailConfig();
    if (!azureConfig) {
      return new Response(JSON.stringify({ error: "Azure email not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken: string;
    try {
      accessToken = await getGraphAccessToken(azureConfig);
    } catch (err) {
      console.error("Follow-up runner: Graph token error:", (err as Error).message);
      return new Response(JSON.stringify({ error: "Auth failed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only process rules whose campaign is currently Active.
    const { data: rules, error: rulesErr } = await supabase
      .from("campaign_follow_up_rules")
      .select("id, campaign_id, template_id, wait_business_days, max_attempts, is_enabled, created_by, campaigns!inner(status)")
      .eq("is_enabled", true)
      .eq("campaigns.status", "Active");

    if (rulesErr) throw rulesErr;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const rule of (rules || []) as (Rule & { campaigns: any })[]) {
      if (!rule.template_id) { skipped++; continue; }

      const cutoff = businessDaysAgo(rule.wait_business_days).toISOString();

      const { data: parents } = await supabase
        .from("campaign_communications")
        .select("id, contact_id, account_id, subject, body, conversation_id, internet_message_id, graph_message_id, follow_up_attempt, owner")
        .eq("campaign_id", rule.campaign_id)
        .eq("communication_type", "Email")
        .eq("delivery_status", "sent")
        .lt("communication_date", cutoff)
        .lt("follow_up_attempt", rule.max_attempts);

      if (!parents || parents.length === 0) continue;

      const { data: template } = await supabase
        .from("campaign_email_templates")
        .select("subject, body")
        .eq("id", rule.template_id)
        .maybeSingle();
      if (!template) { skipped++; continue; }

      for (const parent of parents) {
        // Stop condition: a reply (inbound) exists in this conversation.
        if (parent.conversation_id) {
          const { count: replyCount } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", rule.campaign_id)
            .eq("conversation_id", parent.conversation_id)
            .eq("delivery_status", "received");
          if ((replyCount ?? 0) > 0) continue;
        }

        // Don't double-queue.
        const { count: existing } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("follow_up_parent_id", parent.id);
        if ((existing ?? 0) > 0) continue;

        if (!parent.contact_id) continue;
        const { data: contact } = await supabase
          .from("contacts")
          .select("email, contact_name")
          .eq("id", parent.contact_id)
          .maybeSingle();
        if (!contact?.email) { skipped++; continue; }

        // Resolve sender mailbox from rule creator's profile.
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select('"Email ID"')
          .eq("id", rule.created_by)
          .maybeSingle();
        const senderEmail = (senderProfile?.["Email ID"] || azureConfig.senderEmail).trim();

        const subject = template.subject || `Re: ${parent.subject || ""}`;
        const htmlBody = plainToHtml(template.body || "");

        const result = await sendEmailViaGraph(
          accessToken,
          senderEmail,
          contact.email,
          contact.contact_name || contact.email,
          subject,
          htmlBody,
          senderEmail,
          parent.graph_message_id || undefined,
          parent.internet_message_id || undefined,
        );

        const nowIso = new Date().toISOString();
        const nextAttempt = (parent.follow_up_attempt || 0) + 1;

        if (result.success) {
          // Insert as a delivered follow-up so it shows up in the same thread
          // (Graph keeps the conversationId for replies via subject + recipient match).
          await supabase
            .from("campaign_communications")
            .insert({
              campaign_id: rule.campaign_id,
              contact_id: parent.contact_id,
              account_id: parent.account_id,
              communication_type: "Email",
              subject,
              body: template.body || "",
              email_status: "Sent",
              delivery_status: "sent",
              sent_via: "azure",
              template_id: rule.template_id,
              conversation_id: result.conversationId || parent.conversation_id,
              internet_message_id: result.internetMessageId || null,
              graph_message_id: result.graphMessageId || null,
              follow_up_parent_id: parent.id,
              follow_up_attempt: nextAttempt,
              parent_id: parent.id,
              owner: rule.created_by,
              created_by: rule.created_by,
              communication_date: nowIso,
              notes: `Auto follow-up by rule ${rule.id} (waited ${rule.wait_business_days} business days, no reply).`,
            });

          await supabase
            .from("campaign_communications")
            .update({ follow_up_attempt: nextAttempt })
            .eq("id", parent.id);

          sent++;
        } else {
          // Log failure as a Failed comm row so the user sees what happened.
          await supabase
            .from("campaign_communications")
            .insert({
              campaign_id: rule.campaign_id,
              contact_id: parent.contact_id,
              account_id: parent.account_id,
              communication_type: "Email",
              subject,
              body: template.body || "",
              email_status: "Failed",
              delivery_status: "failed",
              sent_via: "azure",
              template_id: rule.template_id,
              follow_up_parent_id: parent.id,
              follow_up_attempt: nextAttempt,
              owner: rule.created_by,
              created_by: rule.created_by,
              communication_date: nowIso,
              notes: `Auto follow-up FAILED (${result.errorCode || "SEND_FAILED"}): ${(result.error || "").slice(0, 240)}`,
            });

          await supabase
            .from("campaign_communications")
            .update({ follow_up_attempt: nextAttempt })
            .eq("id", parent.id);

          failed++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      sent,
      failed,
      skipped,
      rules_processed: (rules || []).length,
    }), {
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
