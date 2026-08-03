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

    const body = await req.json().catch(() => ({}));
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ userDisplayNames: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Query profiles with the caller's JWT so RLS on profiles decides what the
    // caller can see. We only return display names — never emails.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${gate.token}` } } },
    );

    const requested: string[] = Array.from(
      new Set(userIds.filter((v: unknown) => typeof v === "string")),
    );

    const { data: profiles } = await callerClient
      .from("profiles")
      .select("id, full_name")
      .in("id", requested);

    const userDisplayNames: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string | null }) => {
      const name = (p.full_name ?? "").trim();
      userDisplayNames[p.id] = name && !name.includes("@") ? name : "User";
    });

    requested.forEach((id) => {
      if (!userDisplayNames[id]) userDisplayNames[id] = "Unknown User";
    });

    return new Response(
      JSON.stringify({ userDisplayNames }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("fetch-user-display-names error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
