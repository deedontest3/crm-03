// Shared auth-gate helpers for edge functions.
//
// Three helpers, three caller shapes:
//   - requireUser(req)  — a real end-user JWT (rejects missing header, non-Bearer,
//                         and the public anon/publishable key).
//   - requireAdmin(req) — requireUser + DB-backed has_role(uid, 'admin'|'super_admin').
//                         Never falls back to user_metadata.
//   - requireCronSecret(req) — constant-time compare of x-cron-secret against
//                         CAMPAIGN_CRON_SECRET. Fail-closed if the env var is unset.
//
// Any of these returns either an "ok" object or a Response the handler should
// return directly. Callers must always check `if ("response" in gate) return gate.response;`.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.52.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

export type AuthGateFailure = { response: Response };
export type UserGateSuccess = { userId: string; claims: Record<string, unknown>; token: string };
export type AdminGateSuccess = UserGateSuccess & { role: "admin" | "super_admin" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Timing-safe string compare. */
function constantTimeEquals(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
    return JSON.parse(atob(pad));
  } catch {
    return null;
  }
}

let cachedAdmin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return cachedAdmin;
}

/**
 * Verify a real end-user JWT on the request. Rejects:
 *  - missing / non-Bearer Authorization header
 *  - the public anon/publishable key (role === 'anon' in the JWT payload)
 *  - any token the auth server does not accept
 */
export async function requireUser(req: Request): Promise<UserGateSuccess | AuthGateFailure> {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { response: json(401, { error: "Unauthorized" }) };
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return { response: json(401, { error: "Unauthorized" }) };

  const decoded = decodeJwtPayload(token);
  if (decoded && (decoded.role === "anon" || decoded.role === "service_role")) {
    // service_role must never authenticate as a user; force it through requireCronSecret
    // or an explicit internal caller path.
    if (decoded.role === "anon") {
      return { response: json(401, { error: "Unauthorized: anon key not accepted" }) };
    }
    return { response: json(401, { error: "Unauthorized: service role not accepted here" }) };
  }

  const supabase = adminClient();
  // Prefer getClaims to avoid a network round-trip when the JWT signer key is known.
  // Fall back to getUser if getClaims is unavailable on this SDK.
  const anyAuth = supabase.auth as unknown as {
    getClaims?: (jwt: string) => Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
  };
  if (typeof anyAuth.getClaims === "function") {
    const { data, error } = await anyAuth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return { response: json(401, { error: "Unauthorized" }) };
    }
    return { userId: String(data.claims.sub), claims: data.claims, token };
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { response: json(401, { error: "Unauthorized" }) };
  }
  return { userId: data.user.id, claims: { sub: data.user.id, email: data.user.email }, token };
}

/**
 * requireUser + DB-backed role check. No user_metadata fallback, ever.
 */
export async function requireAdmin(req: Request): Promise<AdminGateSuccess | AuthGateFailure> {
  const user = await requireUser(req);
  if ("response" in user) return user;
  const { data, error } = await adminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", user.userId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();
  if (error || !data?.role) {
    return { response: json(403, { error: "Forbidden" }) };
  }
  return { ...user, role: data.role as "admin" | "super_admin" };
}

/**
 * Constant-time compare of x-cron-secret against CAMPAIGN_CRON_SECRET.
 * Fail-closed: if the env var is unset, returns 500 (never treats unset as pass).
 */
export function requireCronSecret(req: Request): { ok: true } | AuthGateFailure {
  const secret = Deno.env.get("CAMPAIGN_CRON_SECRET");
  if (!secret) {
    console.error("CAMPAIGN_CRON_SECRET not configured — refusing request");
    return { response: json(500, { error: "Server not configured" }) };
  }
  const header = req.headers.get("x-cron-secret") || "";
  if (!constantTimeEquals(header, secret)) {
    return { response: json(403, { error: "Forbidden" }) };
  }
  return { ok: true };
}

export { corsHeaders as authGateCorsHeaders };
