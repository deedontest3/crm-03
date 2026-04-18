

## Improve /campaigns Dashboard

### Current Bugs & Issues Found
1. **Activity Summary card too wide** — takes 8/12 columns but only shows 3 small stat rows; pie chart cramped at 4/12.
2. **Stats use `campaigns` (filtered to active) but the count badge in header shows `campaigns.length`** — both exclude archived; that's fine, but stat cards say "Total" which is misleading. Should be "Total Active".
3. **Communication count is undifferentiated** — 22 comms exist split across Email/Call/Phone/LinkedIn but dashboard shows one number, losing channel insight.
4. **No time-based insight** — no trend of campaigns created over months, no upcoming/ending soon view.
5. **No engagement metrics** — email replied/sent/failed counts exist in `campaign_communications.email_status` but not surfaced.
6. **No top-performing campaigns** — table shows all 8 unsorted; missing "by activity" or "by reply rate".
7. **Aggregates re-fetched only on `campaigns.length` change** — won't refresh when comms/accounts added; should use react-query for cache invalidation consistency.
8. **Pie chart click filter only filters the table — stat card "Total" highlight logic is buggy** (always shows ring when no filter).
9. **Strategy column** in dashboard table doesn't visually convey progress (just "0/4" text) — should be a tiny progress bar.
10. **No "ending soon" / "overdue" alerts** — campaigns past `end_date` but still Active aren't flagged.

### Proposed Layout (12-col grid)

```text
[Stat Cards: Total | Active | Draft | Completed | Paused]   (5 small cards)

[Status Pie 3] [Channel Mix Bar 3] [Email Engagement 3] [Quick Stats 3]
   donut          horiz bars         donut + numbers       4 mini stats:
                                                             Accounts / Contacts
                                                             Comms / Avg per camp

[Campaigns Timeline 6]              [Top Active Campaigns 6]
   Bar chart: created per month       List sorted by communications count
                                       with mini progress + reply rate

[All Campaigns Table — full width]
   Existing table + new "Engagement" column (replies/sent),
   Strategy as mini progress bar, sortable headers
```

### Changes to `src/components/campaigns/CampaignDashboard.tsx`

**Add new aggregates fetched once**:
- `commsBycamp` split by `communication_type` (Email/Call/Phone/LinkedIn)
- `emailStatusCounts` (Sent / Replied / Failed) globally
- `repliesBycamp` (count where `email_status='Replied'`)
- `createdByMonth` derived from campaigns

**New widgets**:
1. **Channel Mix** (horizontal bar chart): Email vs Call vs Phone vs LinkedIn comms.
2. **Email Engagement** (compact donut + numbers): Sent / Replied / Failed with reply-rate %.
3. **Quick Stats** (2x2 grid): Accounts Targeted, Contacts Added, Total Comms, Avg Comms/Campaign.
4. **Campaign Timeline** (bar chart): campaigns created per month over last 6 months.
5. **Top Active Campaigns** (sorted list): top 5 by communication count, each row shows name, comms count, reply rate, mini MART progress.

**Bug fixes**:
- Replace single broad "Activity Summary" with the 4-tile row above (fixes width issue).
- Fix "Total" ring logic: only highlight when explicitly clicked, not by default.
- Add ending-soon banner if any active campaign has `end_date` within 7 days or past due.
- Add Strategy mini progress bar in table.
- Add "Engagement" column to table (e.g. `5/16 replies`).
- Switch aggregate `useEffect` to a `useQuery` keyed on `["campaign-aggregates"]` so it invalidates with other campaign mutations.

### File

| File | Action |
|---|---|
| `src/components/campaigns/CampaignDashboard.tsx` | Rewrite layout: 4-tile chart row + timeline + top campaigns + improved table |

