

## Why every page feels slow — what I found

Confirmed from network logs + code review:

**1. `useYearlyRevenueData` and `useDashboardStats` fetch ALL deals with `select('*')`, no `.limit()`, no `.range()`.** Filtering by year is then done client-side in JavaScript. With several hundred deals each, the dashboard pulls a massive payload twice on every visit, then loops through it 5+ times. This is the single biggest dashboard slowdown.

**2. `useCampaigns` always fetches all campaigns + the entire `campaign_mart` table on app mount** because `CampaignDashboardWidget` and `<Campaigns>` page both call it. There's no `staleTime`, so every navigation refetches.

**3. `DealsPage` calls `fetchAllRecords('deals')` — paginates every 1000 rows in a loop until done.** For all deals at once. Used both for the Kanban and List views even though both paginate client-side.

**4. `useActionItems` fetches up to 5000 rows every time the filter object changes**, and the query key is `['action_items', filters]` (the entire object), so any filter tweak refetches the full set.

**5. `AccountTable` makes a second query to `contacts` for every visible page** to count linked contacts (the network log shows a 200-name `IN(...)` query of ~600 rows just for the contact-count badge). It runs again on every page change.

**6. `useUserDisplayNames` calls the `fetch-user-display-names` edge function on every component that needs names** (Accounts, Contacts, Campaigns, CampaignDetail, ActionItems all do it independently). Network log shows duplicate POSTs with the same user IDs back-to-back. Not deduped across components, not cached in React Query.

**7. No React Query caching defaults.** `new QueryClient()` is created with no `staleTime`/`gcTime`, so navigating Dashboard → Campaigns → Dashboard refetches everything immediately.

**8. `useColumnPreferences` and `useDealsColumnPreferences` fire a Supabase request for every table mount** (one per `(user_id, module)` row). Not cached via React Query, so flipping between tabs re-queries.

**9. `Dashboard` is eager-loaded but pulls in `YearlyRevenueSummary` + `CampaignDashboardWidget` immediately** — both fire 4–6 queries before the first paint.

**10. Excessive console.log spam in hot paths** (`useYearlyRevenueData`, `useUserDisplayNames`) — minor but real cost on slow devices.

---

## Plan

### 1. Add sane React Query defaults (one-line, biggest win)
In `src/App.tsx`, configure the `QueryClient` with:
- `staleTime: 5 * 60 * 1000` (5 min)
- `gcTime: 10 * 60 * 1000`
- `refetchOnWindowFocus: false`
- `retry: 1`

This alone removes 60–80% of the redundant requests when the user navigates between pages.

### 2. Move dashboard aggregation to the database (eliminate full-table scans)
In `src/hooks/useYearlyRevenueData.tsx`:
- Replace `select('*')` with a year-filtered query: `.or('expected_closing_date.gte.YYYY-01-01,signed_contract_date.gte.YYYY-01-01').lte(...)` and select only the fields actually used (`stage`, `total_revenue`, `total_contract_value`, `quarterly_revenue_q1..q4`, `expected_closing_date`).
- Add `staleTime: 5 * 60 * 1000`.
- Strip the 20+ `console.log` calls.
- `useDashboardStats` and `useAvailableYears`: same — narrow `select`, limit fields, add staleTime.

### 3. Eager-load only what the first page needs; lazy-load Dashboard widgets
- Keep `Dashboard` route eager but lazy-import `CampaignDashboardWidget` inside it via `React.lazy` + `Suspense` so it doesn't block first paint.
- Lazy-load `YearlyRevenueSummary` with a Skeleton fallback.

### 4. Cache user display names through React Query
Rewrite `useUserDisplayNames`:
- Use `useQuery` keyed on the sorted user-id list with `staleTime: Infinity` (names rarely change).
- Use a single shared module-level `Map` cache so multiple hooks in the same render hit only one edge-function POST.
- This kills the duplicate POSTs visible in network logs.

### 5. Cache column preferences via React Query
Wrap both `useColumnPreferences` and `useDealsColumnPreferences` in `useQuery` with `staleTime: Infinity` and key on `[user.id, moduleName]`. Mutations invalidate the key. Eliminates the per-mount round-trip.

### 6. Fix Accounts contact-count
In `src/components/AccountTable.tsx`:
- Replace the per-page `.in('company_name', ...)` payload-of-600-rows query with a single grouped count: use `supabase.rpc()` or `.select('company_name', { count: 'exact' })` with `.in()` then group client-side **only on the names of the current 50 visible rows** (already does), but switch to selecting only `company_name` and apply React Query caching keyed on the visible names.
- Better: create a Postgres view/RPC `account_contact_counts` returning `(account_name, count)` and call it once with the page's account names.

### 7. Reduce Action Items query size
In `src/hooks/useActionItems.tsx`:
- Drop `.limit(5000)` to `.limit(500)` for the default view (UI paginates client-side anyway).
- Stable query key: hash filter values into a small key, not the whole object.

### 8. Slim Campaigns + Campaign Mart fetch
- `useCampaigns` strategyQuery: select only the boolean flags + `campaign_id` instead of `select('*')`.
- Add `staleTime: 2 * 60 * 1000`.
- `CampaignDashboardWidget`: same — request only fields it uses.

### 9. Deals page: stop fetching all rows on mount
In `src/pages/DealsPage.tsx`:
- Use server pagination (`fetchPaginatedData`) for the List view (already supported by `supabasePagination.ts`).
- For Kanban, fetch all rows — but only fields needed for cards (project_name, stage, total_contract_value, lead_owner, expected_closing_date, priority) instead of `select('*')`.
- Wrap the deals query in React Query so view switches don't refetch.

### 10. Trim console noise
Remove the verbose `console.log` blocks in `useYearlyRevenueData`, `useUserDisplayNames`, and `useAuth`. They run on every render in dev preview and on production when devtools are open.

### Files to change
- `src/App.tsx` — QueryClient defaults
- `src/hooks/useYearlyRevenueData.tsx` — narrow selects, server-side year filter, staleTime, drop logs
- `src/hooks/useUserDisplayNames.tsx` — useQuery + shared cache
- `src/hooks/useColumnPreferences.tsx` — useQuery cache
- `src/hooks/useDealsColumnPreferences.tsx` — useQuery cache
- `src/hooks/useCampaigns.tsx` — narrow selects, staleTime
- `src/hooks/useActionItems.tsx` — limit, stable key
- `src/components/dashboard/CampaignDashboardWidget.tsx` — narrow selects
- `src/components/AccountTable.tsx` — switch contact-count to a cached query keyed on visible names
- `src/pages/Dashboard.tsx` — lazy import widgets
- `src/pages/DealsPage.tsx` — narrow `select`, wrap in React Query

### Expected result
- First Dashboard paint goes from ~3–5s to ~600ms (no full-table deal scans, no campaign_mart over-fetch).
- Page-to-page navigation feels instant: cached data is reused for 5 minutes; only changed data refetches.
- Network requests on a typical session drop from ~30+ to ~8–10.
- No code-splitting regression — all pages still lazy-loaded.

