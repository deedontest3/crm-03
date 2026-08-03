import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";
import { requireUser } from "../_shared/auth-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const gate = await requireUser(req);
    if ("response" in gate) return gate.response;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { userIds } = body ?? {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "userIds (array) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Restrict lookup to ids the caller can already see through the profiles
    // table (RLS scoped) plus their own id. We NEVER return email — display
    // name only — to keep this endpoint from being a directory-scraping tool.
    const requested: string[] = Array.from(
      new Set(userIds.filter((v: unknown) => typeof v === "string" && v.length > 0)),
    );

    // Query profiles as a SERVICE client but respect the "profiles RLS view of
    // the caller" by re-querying with the caller's JWT for the id-visibility
    // set. If profiles RLS grants a row, we include it.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${gate.token}` } } },
    );
    const { data: visibleProfiles } = await callerClient
      .from("profiles")
      .select("id, full_name")
      .in("id", requested);

    const displayNames: Record<string, string> = {};
    // Always include the caller's own id.
    displayNames[gate.userId] = displayNames[gate.userId] || "You";

    (visibleProfiles || []).forEach((p: { id: string; full_name: string | null }) => {
      displayNames[p.id] = p.full_name || "User";
    });

    // Any id the caller asked for but can't see gets "Unknown User" — never
    // reveal existence beyond what profiles RLS already allows.
    requested.forEach((id) => {
      if (!displayNames[id]) displayNames[id] = "Unknown User";
    });

    return new Response(
      JSON.stringify({ userDisplayNames: displayNames }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("get-user-names error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
