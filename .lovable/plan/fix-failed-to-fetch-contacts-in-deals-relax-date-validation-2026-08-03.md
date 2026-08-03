# Fix "Failed to fetch contacts" in Deals + relax date validation

## 1. Why the contacts error appears

Confirmed from the browser console captured with your message:

```text
get_account_linked_contacts RPC unavailable; using client fallback
{ "code": "57014", "message": "canceling statement due to statement timeout" }
  at ContactSearchableDropdown.tsx
```

When the deal form opens, the Contact Name dropdown asks the database for the
contacts linked to the deal's account. That database function times out, the
code falls back to loading every contact + deal in the browser, and when that
also fails you get the red "Failed to fetch contacts" toasts (one per dropdown
instance, which is why you see three).

Root cause of the timeout: the function matches contacts to accounts by calling
a text-normalising company-name function for every contact/account pair
(4,432 contacts x 643 accounts), so the database cannot use any index and the
query runs past the statement timeout.

### Fix

- Make the name-normalising helpers `normalize_company_key` /
  `company_keys_match` `IMMUTABLE` so Postgres can cache and index them.
- Add expression indexes on `normalize_company_key(contacts.company_name)`,
  `normalize_company_key(accounts.account_name)` and
  `normalize_company_key(deals.customer_name)`.
- Rewrite `get_account_linked_contacts` so the company-name matches join on the
  precomputed normalised key (equality + prefix on an indexed expression)
  instead of a per-row function call.
- Frontend hardening in `ContactSearchableDropdown.tsx`: when the linked-contact
  lookup fails, fall back to a plain 200-row contacts query filtered by
  `account_id` instead of the whole-table client fallback, and show the error
  toast only once instead of once per dropdown.

## 2. Relax the hard date rules

Remove the "must be today or later / cannot be in the past" blocking rules in
`src/components/deal-form/validation.ts`:

- Target Closure date must be today or later while the deal is open (L15)
- Expected PO Signing Date must be today or later until PO is Received
- Revise Date must be in the future (Hold stage)
- Verbal Approval Date cannot be in the future
- Database trigger `validate_deal_dates`: drop the "Signed contract date cannot
  be in the future" exception

Kept (these are relationship rules, not calendar-position rules, and prevent
genuinely broken data):

- RFQ Received <= Submission <= Target Closure
- Project Start <= Project End, Signed Contract <= Project Start
- Verbal Approval <= Expected PO Signing

So back-dated and forward-dated deals both save fine; only self-contradictory
orderings are still blocked.

## Technical notes

- One migration: immutable helpers, expression indexes, rewritten
  `get_account_linked_contacts`, relaxed `validate_deal_dates`.
- Frontend edits: `src/components/deal-form/validation.ts`,
  `src/components/ContactSearchableDropdown.tsx`.
- No schema/column changes, no data changes.
