/**
 * True when a Supabase RPC error indicates the function does not exist on the
 * project (PostgREST 404 / PGRST202) rather than a runtime / permission error.
 *
 * Used by callers that ship an atomic SECURITY DEFINER RPC plus a legacy
 * client-side fallback. Checking the PostgREST error `code` first is far more
 * stable than regex-matching the human message, which changes between Postgres
 * versions.
 */
export const isRpcMissingError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; hint?: string };
  if (e.code === "PGRST202" || e.code === "42883") return true;
  const msg = `${e.message || ""} ${e.hint || ""}`.toLowerCase();
  return (
    msg.includes("could not find the function") ||
    /function .*does not exist/.test(msg)
  );
};
