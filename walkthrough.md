# Walkthrough

## Deal stage display labels (Lx prefix)

Pipeline stages now render with an `Lx - ` prefix in the UI, reverse-ordered so the most advanced stage is `L0`:

- `L0 - Won`
- `L1 - Verbal Approval`
- `L2 - Negotiation`
- `L3 - Offered`
- `L4 - RFQ`
- `L5 - Qualified`
- `L6 - Discussions`
- `L7 - Lead`

`Lost`, `Hold`, and `Dropped` render unprefixed. This is a display-only change — internal `DealStage` values, the Supabase enum, stored rows, filtering, ordering, probability, and pipeline-move logic are unchanged. All UI surfaces (Kanban headers, deal form stepper/badges, stage selects, list view cells, advanced filter checkboxes, backward-move confirm dialog, missing-fields dialog, quarter drill-down) route through `getStageLabel()` exported from `src/types/deal.ts`.

## Annual Target currency now follows the display filter

The Annual Target KPI on Revenue Analytics now converts into the currently selected display currency (€ / $ / ₹) using the stored fixed FX rates, instead of always rendering in the currency it was saved with. A subtitle "Originally set as {amount} {currency}" appears when the two differ, so the source of truth stays visible. Quarterly target values used in the Quarterly Breakdown are converted the same way, so quarter forecast/target comparisons live in one currency.

Additionally, saving a new target now invalidates the `yearly-revenue-fy` React Query cache so the KPI reflects the new value + currency immediately without a page reload. The FixedRateBanner rate editor also invalidates `currency-rates` and `yearly-revenue-fy` so every KPI re-renders with the new rate right away.

