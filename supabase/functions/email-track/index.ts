import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// 1×1 transparent PNG
const PIXEL = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
), c => c.charCodeAt(0));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const pixelHeaders = {
  ...corsHeaders,
  "Content-Type": "image/png",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

function pixelResponse() {
  return new Response(PIXEL, { status: 200, headers: pixelHeaders });
}

// Heuristic: detect prefetch / scanner opens that should NOT count as a real open.
// IP prefixes are loaded from `email_bot_ip_ranges` so admins can update without redeploy.
let IP_CACHE: { prefixes: string[]; expiresAt: number } = { prefixes: [], expiresAt: 0 };
const IP_CACHE_TTL_MS = 5 * 60_000;

async function loadBotIpPrefixes(supa: ReturnType<typeof createClient>): Promise<string[]> {
  const now = Date.now();
  if (IP_CACHE.expiresAt > now) return IP_CACHE.prefixes;
  try {
    const { data } = await supa
      .from("email_bot_ip_ranges")
      .select("cidr")
      .eq("is_enabled", true);
    const prefixes = ((data || []) as { cidr: string }[]).map((r) => r.cidr.toLowerCase()).filter(Boolean);
    IP_CACHE = { prefixes, expiresAt: now + IP_CACHE_TTL_MS };
    return prefixes;
  } catch (_e) {
    // On read error, keep last good cache; if empty, fall back to nothing (UA still gates).
    return IP_CACHE.prefixes;
  }
}

function looksLikeBot(req: Request, ipPrefixes: string[]): boolean {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  const fwd = (req.headers.get("x-forwarded-for") || "").toLowerCase();
  const purpose = (req.headers.get("purpose") || req.headers.get("sec-purpose") || "").toLowerCase();

  if (purpose.includes("prefetch")) return true;

  const botSignals = [
    "googleimageproxy", "ggpht.com", "bingpreview", "yahoomailproxy",
    "mimecast", "proofpoint", "barracuda", "microsoft office",
    "msofficeoutlook", "outlookimageproxy", "exchange", "symantec",
    "trendmicro", "forcepoint", "fireeye", "sophos",
    "linkedin", "facebookexternalhit", "slackbot", "twitterbot",
    "headlesschrome", "phantomjs", "puppeteer",
  ];
  if (botSignals.some((s) => ua.includes(s))) return true;

  // Admin-managed CIDR/prefix list (substring match on x-forwarded-for is sufficient
  // for the broad ranges we care about; full CIDR parsing is overkill here).
  if (ipPrefixes.length > 0 && ipPrefixes.some((p) => fwd.includes(p))) return true;

  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const tracking = url.searchParams.get("t");
    if (!tracking) return pixelResponse();

    // Validate UUID shape
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tracking)) {
      return pixelResponse();
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing } = await supabase
      .from("campaign_communications")
      .select("id, opened_at, open_count, last_opened_at, is_bot_open, communication_date")
      .eq("tracking_id", tracking)
      .maybeSingle();

    if (existing) {
      const now = new Date().toISOString();
      const ipPrefixes = await loadBotIpPrefixes(supabase);
      const isBot = looksLikeBot(req, ipPrefixes);

      // Bot heuristic v2:
      //   - Real users almost never open in <5s (was 30s — that suppressed many
      //     warm intros where the recipient was already in the inbox).
      //   - At <5s we still want a corroborating signal before flagging a bot:
      //     either the UA looks like a known scanner, OR a second open lands
      //     within 2s of the first (classic prefetch double-tap).
      const sentAt = existing.communication_date ? new Date(existing.communication_date).getTime() : 0;
      const sinceSendMs = sentAt ? Date.now() - sentAt : Number.POSITIVE_INFINITY;
      const lastOpenMs = existing.last_opened_at ? Date.now() - new Date(existing.last_opened_at).getTime() : Number.POSITIVE_INFINITY;
      const veryFast = sentAt && sinceSendMs < 5_000;
      const burst = lastOpenMs < 2_000;

      // Treat as bot when:
      //   1) UA matches a known scanner, OR
      //   2) Open is <5s post-send AND we see a corroborating signal (UA OR burst).
      const treatAsBot = isBot || (veryFast && (isBot || burst));

      const update: Record<string, unknown> = {
        last_opened_at: now,
        open_count: (existing.open_count ?? 0) + 1,
      };

      if (!treatAsBot) {
        // Only stamp opened_at and clear is_bot_open when it's a real open.
        update.opened_at = existing.opened_at ?? now;
        if (existing.is_bot_open) update.is_bot_open = false;
      } else if (!existing.opened_at) {
        // First touch ever, and it looks like a bot — flag it so dashboards exclude it.
        update.is_bot_open = true;
      }

      await supabase
        .from("campaign_communications")
        .update(update)
        .eq("id", existing.id);
    }
  } catch (err) {
    console.error("email-track error:", err);
  }

  return pixelResponse();
});
