/**
 * Helpers for rendering user names in history/audit columns.
 *
 * When a user is deleted we keep a tombstoned `profiles` row
 * (is_deleted = true) so that historical references like
 * created_by / modified_by / assigned_to still resolve to the
 * original name. UI should call these helpers to render a clear
 * "(deleted)" indicator next to the name.
 */

export interface UserDisplayProfile {
  full_name?: string | null;
  "Email ID"?: string | null;
  deleted_email?: string | null;
  is_deleted?: boolean | null;
}

export function formatUserName(
  profile: UserDisplayProfile | null | undefined,
  fallback = "Unknown user",
): string {
  if (!profile) return fallback;
  const base =
    profile.full_name ||
    profile["Email ID"] ||
    profile.deleted_email ||
    fallback;
  return profile.is_deleted ? `${base} (deleted)` : base;
}

export function isDeletedProfile(
  profile: UserDisplayProfile | null | undefined,
): boolean {
  return !!profile?.is_deleted;
}
