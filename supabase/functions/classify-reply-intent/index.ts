import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronSecret, requireUser } from "../_shared/auth-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// In-memory per-user token bucket: 30 requests per minute per user. This is
// intentionally lightweight — the isolate is short-lived, so worst-case a
// determined attacker gets 30 * N_isolates per minute, which is still bounded.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();
function rateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return true;
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Classify a reply email body into one of:
 *   positive | negative | neutral | auto-reply | meeting-requested
 * Persists `reply_intent` on the campaign_communications row.
 *
 * Body: { communication_id: uuid }
 */
/** Local heuristic — catches obvious cases without hitting the LLM. */
function classifyHeuristic(subject: string, body: string): string | null {
  const s = `${subject || ''}\n${body || ''}`.toLowerCase();

  // Auto-replies / OOO
  if (
    /out of (the )?office|on vacation|on holiday|away from (the )?office|auto[-\s]?reply|automatic reply|do[-\s]?not[-\s]?reply|no[-\s]?reply|currently out|will be back|delivery (failure|status notification)|mail delivery|undeliverable/.test(s)
  ) {
    return 'auto-reply';
  }

  // Hard unsubscribe / negative
  if (
    /unsubscribe|remove me|stop emailing|do not contact|not interested|please remove|take me off|opt[-\s]?out|don['’]t (email|contact) (me|us)/.test(s)
  ) {
    return 'negative';
  }

  // Meeting requested
  if (
    /(let['’]s|let us|can we|could we|happy to|happy to chat|schedule a (call|meeting)|book a (call|meeting)|set up a (call|meeting)|jump on a call|hop on a call|calendly|when (are you|works for you)|what time works)/.test(s)
  ) {
    return 'meeting-requested';
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Cron OR authenticated user. No more length-of-string bypass.
    const cron = requireCronSecret(req);
    let rateKey = "cron";
    if ("response" in cron) {
      const user = await requireUser(req);
      if ("response" in user) return user.response;
      rateKey = `user:${user.userId}`;
      if (!rateLimit(rateKey)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI Gateway not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { communication_id } = await req.json();
    if (!communication_id) {
      return new Response(JSON.stringify({ error: "communication_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error } = await supabase
      .from("campaign_communications")
      .select("id, subject, body, reply_intent")
      .eq("id", communication_id)
      .maybeSingle();

    if (error || !row) {
      return new Response(JSON.stringify({ error: "Communication not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.reply_intent) {
      return new Response(JSON.stringify({ intent: row.reply_intent, cached: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Heuristic first — avoids LLM cost for ~60-70% of inbound replies.
    const heuristicIntent = classifyHeuristic(row.subject || '', row.body || '');
    if (heuristicIntent) {
      await supabase
        .from("campaign_communications")
        .update({ reply_intent: heuristicIntent })
        .eq("id", communication_id);
      return new Response(
        JSON.stringify({ intent: heuristicIntent, source: 'heuristic' }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const prompt = `You classify outbound-sales reply emails. Categories:
- positive: interested, wants to learn more, asks questions
- negative: not interested, hard no, unsubscribe
- neutral: ambiguous, "circle back later", "send info"
- auto-reply: out-of-office, vacation, no-reply bot
- meeting-requested: explicitly asks to schedule, gives availability

Subject: ${row.subject || "(no subject)"}
Body:
${(row.body || "").slice(0, 2000)}

Respond ONLY with one of: positive | negative | neutral | auto-reply | meeting-requested`;

    const aiRes = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 16,
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited", retryAfter: 60 }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI error:", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "AI request failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const raw = (aiJson.choices?.[0]?.message?.content || "").toLowerCase().trim();
    const allowed = ["positive", "negative", "neutral", "auto-reply", "meeting-requested"];
    const intent = allowed.find((c) => raw.includes(c)) || "neutral";

    await supabase
      .from("campaign_communications")
      .update({ reply_intent: intent })
      .eq("id", communication_id);

    return new Response(JSON.stringify({ intent, source: 'ai' }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("classify-reply-intent error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});