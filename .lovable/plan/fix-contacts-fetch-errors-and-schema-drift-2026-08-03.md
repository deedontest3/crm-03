# Fix Contacts Fetch Errors and Schema Drift

## Confirmed cause

- The live `public.contacts` table has 19 columns and does **not** contain `mobile_no`, `city`, `state`, `lead_status`, `annual_revenue`, or `no_of_employees`.
- Those six columns were intentionally dropped by migration, but several Contacts frontend paths still reference them.
- Contact search currently sends `mobile_no.ilike...`, producing PostgREST error `42703` and preventing the entire page query from returning.
- The same stale fields remain in the contact form, filtered CSV export, export field list, and generic CSV header mappings, so those workflows can also fail.
- The current fetch effects can issue redundant requests, which turns one backend error into repeated error toasts.
- Contacts RLS policies are present and ownership-scoped; this incident is not a permissions failure.

## Implementation

1. **Align contact search and table types with the live schema**
   - Remove `mobile_no` from the server-side search fields.
   - Remove all six dropped fields from Contacts-only interfaces and rendering paths.
   - Keep search over the supported fields: contact name, account/company, email, and phone.

2. **Make create and edit safe**
   - Remove the six obsolete controls, validation fields, defaults, and write payload properties from the contact modal.
   - Type the form and returned records against the supported contact shape so future stale-field writes are caught during type checking.
   - Preserve all current valid fields and account-linking behavior.

3. **Repair CSV import/export consistency**
   - Restrict the Contacts export field list to columns that exist in the live table.
   - Remove `mobile_no` from filtered export search.
   - Ensure generic header aliases only resolve to columns allowed for the selected table; lead-only aliases such as Mobile, City, Status, Employees, and Revenue must not produce invalid Contacts insert fields.
   - Unsupported legacy Contacts CSV columns will be ignored rather than causing the whole import to fail.

4. **Stop duplicate requests and toast floods**
   - Consolidate contact loading to one request per effective page/filter/search/refresh change instead of overlapping effects.
   - Prevent callback identity and loading-state changes from retriggering the same fetch.
   - Deduplicate the user-facing fetch error while retaining the detailed PostgREST error in the console.

## Technical files

- `src/components/ContactTable.tsx`
- `src/components/contact-table/ContactTableBody.tsx`
- `src/components/ContactModal.tsx`
- `src/hooks/useSimpleContactsImportExport.tsx`
- `src/hooks/import-export/headerMapper.ts`

No database migration is needed because the frontend should follow the intentionally reduced Contacts schema.

## Verification

- Run focused Contacts/import-export tests and the project harness checks.
- In the signed-in preview, verify initial load, text search, clearing search, pagination, owner filtering, and In Deals filtering without `400` requests or repeated toasts.
- Create and edit a contact and confirm the saved row contains only supported columns.
- Export all, filtered, and selected contacts; verify headers match the live schema.
- Import a legacy CSV containing dropped headers and confirm valid contact data imports while obsolete columns are ignored.
