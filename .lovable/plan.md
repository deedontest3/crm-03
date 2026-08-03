# Let admins delete (archive) any deal, and surface the real failure reason

## What I verified in the database

- "Test User 1" resolves to role `admin` (`is_user_admin` returns true for that account).
- The `archive_deals` server function already allows an admin to archive **any** deal, not just their own.
- The deals access rules already allow an admin to edit/archive any active deal.

So the role itself is not the blocker. Two real problems remain:

1. **Validation triggers run on archive.** Archiving is an update, so the deal business-rule and Won-stage-lock triggers still fire. A deal that is in Negotiation / Verbal Approval / Won with "Competition = Yes" but no competitors listed will make the archive update fail. The failure is reported to the user as a generic error / permission message instead of the real reason.
2. **The Dashboard page uses a different, weaker delete path.** `src/pages/Index.tsx` archives with a plain table update instead of the `archive_deals` function, silently reports success even when zero rows change, and does not report per-deal outcomes.

## Changes

### 1. Database (migration)
- Skip business-rule validation when an update is purely an archive/unarchive action (archived state changes and no other business field changes). Normal edits keep all validations.
- Same exemption for the Won-stage lock, so archiving a Won deal never trips the "Won deals are closed" rule.
- Confirm the archive function stays: admin and super admin archive any deal, everyone else only deals they created; viewing, restoring and permanently deleting archived deals stays super-admin only (unchanged, per the existing rule set).

### 2. Deals page error reporting (`src/pages/DealsPage.tsx`)
- When the archive call returns an error, show the actual database message instead of a generic "Failed to archive".
- Keep the "Permission Denied" wording only for genuine permission errors; when some deals are skipped, say which ones and why.

### 3. Dashboard delete path (`src/pages/Index.tsx`)
- Route archiving through the same `archive_deals` function so behaviour and messaging match the Deals page (success count, skipped count, real error text).

## Verification
- As Test User 1 (admin), archive a deal owned by another user from both the Kanban board and the list view, and from the Dashboard view — deal disappears with a "Moved to Archive" toast.
- Archive a Won deal and a Negotiation deal with "Competition = Yes" and no competitors — both archive cleanly.
- Editing (not archiving) a Negotiation deal with Competition = Yes and empty competitors still shows the validation error.
- Admin still sees no Archive entry point; super admin can still restore and permanently delete.
