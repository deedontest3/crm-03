# Admins can archive deals; Super Admins own the Archive

## Goal
Admins and super admins get full control over active deals — create, view, edit, and delete (delete = move to Archive). The Archive itself stays super-admin-only: only a super admin can view archived deals, restore them, or permanently delete them.

## Current state (verified in the database)
- Admins already view and edit all *active* deals.
- Archiving is a deal update that sets `archived_at`. Admins are allowed to perform it, but they cannot read archived rows, so the app's post-update read returns no rows and the UI shows "Failed to archive deals".
- Archived deals: view, edit (restore), and permanent delete are already super-admin-only — that is the desired behaviour and stays.
- Frontend: the Archive entry point on the Deals page is already gated to `super_admin`, which is correct.

## Changes

### 1. Database access rules (migration)
Adjust the deals update rule so an admin can archive a deal without needing to read it back:
- Keep view of archived deals restricted to super admin.
- Keep restore and permanent delete restricted to super admin.
- Keep admin edit/archive rights on active deals.

No change to regular users: they continue to see and edit only the active deals they created.

### 2. Frontend fix for the failed-archive toast
`src/pages/DealsPage.tsx` currently treats "no rows returned" from the archive update as a permission failure. Change the archive handler so it does not depend on reading the archived rows back:
- Run the archive update without requesting the updated rows.
- On success, remove the deals from the local list, log the audit entry, and show the "Moved to Archive" toast.
- Only show the permission error when Supabase actually returns an error.

Archive entry point and the archived-deals dialog stay super-admin-only.

### 3. Verification
- As an admin, delete/archive a deal from the Kanban board and the list view: it disappears from the pipeline with a success toast and no error.
- Confirm the admin sees no Archive button and cannot read archived rows.
- As a super admin, open the Archive, restore one deal and permanently delete another.
