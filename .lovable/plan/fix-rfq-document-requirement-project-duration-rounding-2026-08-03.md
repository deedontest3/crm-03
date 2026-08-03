# Fix RFQ document requirement + project duration rounding

## Issue 1 — "Upload the submitted RFQ" with nowhere to upload

The RFQ stage form validates that a submitted RFQ/proposal document exists, but the RFQ stage never renders the Documents section — that component is only shown on Offered, Verbal Approval, and Won. So the error is unresolvable from the RFQ screen.

Fix:
- Render the Documents section inside the RFQ stage card, always visible (so a user can attach before/after changing status), with the "Submitted RFQ / Proposal" slot marked Required only when RFQ Status is `Submitted`.
- Point the inline error next to RFQ Status at that section ("attach the document below").
- Allow a **document link** as an alternative to uploading a file: each document slot gets both an "Upload" button and an "Add link" action (paste a URL + optional label). A link entry satisfies the same requirement as an uploaded file, so setting status to Submitted passes validation with either.
- Links open in a new tab; uploads keep the existing preview/download behaviour. Both can be deleted the same way.

Because a deal must exist before documents can attach, an unsaved new deal keeps today's "Save the deal first" hint.

## Issue 2 — 02/11/2026 → 29/01/2027 shows 2 months

Duration is computed as a calendar-month difference (Jan minus Nov = 2), ignoring the day-of-month. The real span is 89 days ≈ 2.9 months.

Fix: compute duration from the actual day span and round to the nearest whole month (89 days → 3). Apply the same corrected calculation everywhere duration is derived or drift-warned (RFQ, Offered, Won forms) via one shared helper, so all screens agree.

## Technical notes

- New migration: add `source_type` (`file` | `link`) and `external_url` columns to `public.deal_documents`, make `file_path` nullable for link rows, and extend the `kind` check to include `rfq_submitted` / `proposal` if not already present. Existing rows default to `file`.
- `useDealDocuments`: add an `addLink(kind, url, label)` method; `hasKind` counts link rows too; delete removes storage object only for file rows.
- `DealDocumentsSection`: new "Add link" dialog per slot, link rendering with external-link icon.
- `RFQStageForm`: render `DealDocumentsSection` with `showRfqSubmittedSlot` and `requireRfqSubmitted={rfq_status === 'Submitted'}`.
- New `monthsBetweenRounded(start, end)` helper in `src/lib/dealDate.ts`; RFQ/Offered/Won forms use it instead of their local month-difference logic.
