// Shared caller-authorization helpers for edge functions.
//
// Background: several cron-invoked functions previously "authorized" callers by
// checking only that an Authorization header was PRESENT
// (`!!req.headers.get("authorization")`). The public anon key that pg_cron and
// every browser sends satisfies that, so the check was effectively no auth.
//
// These helpers distinguish the three legitimate caller types — cron, an
// internal service-role caller, and a verified end user — from an anonymous
// attacker holding only the public anon key.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Timing-safe string comparison. */
export function constantTimeEquals(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export interface CronCheck {
  ok: boolean;
  /** Whether a CRON_SECRET is configured at all. */
  configured: boolean;
}

/**
 * Verify the `x-cron-secret` header against the CRON_SECRET env var.
 *
 * Rollout-safe by design:
 *   - If CRON_SECRET is NOT configured, returns { ok: true, configured: false }
 *     so existing scheduled jobs (which don't yet send the header) keep working.
 *     This is never worse than the previous presence-only check.
 *   - Once CRON_SECRET is configured (and the cron jobs are updated to send the
 *     matching header — see the harden-cron-auth migration), a missing/incorrect
 *     header is rejected.
 */
export function verifyCronSecret(req: Request): CronCheck {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return { ok: true, configured: false };
  const header = req.headers.get("x-cron-secret") || "";
  return { ok: constantTimeEquals(header, secret), configured: true };
}

/** True if the bearer token equals the service-role key (internal caller). */
export function isServiceRoleCaller(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  return !!token && constantTimeEquals(token, serviceKey);
}

/**
 * Verify the Authorization bearer as a real user JWT. Returns the user id, or
 * null if there is no valid user session. `adminClient` must be a service-role
 * client (used only to call auth.getUser on the supplied token).
 */
export async function verifyUser(
  req: Request,
  adminClient: SupabaseClient,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  // The anon/publishable key is not a user JWT, so getUser returns no user.
  const { data } = await adminClient.auth.getUser(token);
  return data?.user ? { id: data.user.id } : null;
}

/** True if the given user id has an admin/super_admin row in user_roles. */
export async function isAdminUser(adminClient: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  return data?.role === "admin" || data?.role === "super_admin";
}
