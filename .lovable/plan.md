

# Campaign Workflow — End-to-End Audit & Improvements

I walked the full flow on your live data: **Campaign 2** (Draft, EU + Asia) and **test 1** (Active) — including the **TEST** account and the **Test 1 / Test 2 lukas schleicher** contacts. I found a mix of real bugs, UX gaps, and consistency issues across all 5 stages: **Create → Setup (Region/Audience/Message/Timing) → Activate → Monitoring (send email) → Analytics**.

---

## 🔴 Bugs found

### B1. Build is broken — Edge Function won't deploy
`supabase/functions/email-skip-report/index.ts` line 223: `new Response(pdfBytes, …)` — `pdfBytes` is `Uint8Array`, which fails Deno type checks. **All edge functions fail to deploy** until this is fixed (wrap in `new Uint8Array(pdfBytes).buffer` or pass `pdfBytes as BodyInit`).

### B2. New-campaign modal silently strips Region & Tags
`CampaignModal` form has fields for Name, Type, Priority, Owner, Channel, Dates, Goal, Description — but **no Region, no Tags, no Notes**. Users can't seed regions on creation; they must open the campaign and use the Region step.

### B3. Region card data shape mismatch
`CampaignRegion` writes JSON like `[{country, region, timezone}]` to `campaigns.region`. Several downstream consumers (`CampaignAudience.parseSelectedCountries`, dashboard CSV export, Overview region badges) parse this, but **`campaigns.country` (a separate scalar column) is never updated** — so any code that still reads `campaign.country` shows blank (e.g. AddContactsModal `selectedCountries` prop, certain CSV columns).

### B4. Strategy "Audience done" flag can be marked with 0 reachable contacts
`validateSection("audience")` only checks `accountCount > 0 OR contactCount > 0`. The **TEST** account (your test data) was added with status `Not Contacted` and has 2 contacts both with `region = "EU"` — but the campaign region is **EU + Asia**, so the audience filter shows them. However: **"audience done" can be ticked even when 0 contacts are reachable on the campaign's primary channel**, which then blocks the user inside Monitoring.

### B5. AddContactsModal scopes by `company_name` string equality (case-insensitive)
For account "TEST", contacts `Test 1 lukas schleicher` and `Test 2 Lukas Schleicher` both have `company_name = "TEST"` — they show. But for any account where the contact's `company_name` differs by punctuation/whitespace from `account_name` (e.g. "Eberspaecher, HQ, Germany" vs "Eberspaecher"), contacts won't match. This is silent — users see "No matching contacts".

### B6. Reply-status doesn't propagate to contact stage consistently
Looking at your data: contact `test3` for campaign **test 1** has stage `Responded` (correct — there's an inbound `delivery_status: received`). But `test1` also has a `Re: …Test 1` inbound row and is correctly `Responded`. However `test4` and `test5` were sent to but show `Email Sent`, not `Not Contacted` — the contact-stage updater works for sends but doesn't roll back if a send later fails. There's no clear logic for **Failed** → stage handling.

### B7. Communications: "Not Contacted" check uses raw outbound rows, not threads
On the Monitoring tab, the eligible-recipient counter for "send first email" filters by `stage === 'Not Contacted'`. But `bcef732d…` (Campaign 2) shows `test1, test2, Lukas Schleicher` already at `Email Sent` while `Test 1/2 lukas schleicher` (the new contacts you wanted to test) sit at `Not Contacted`. ✅ Send works for them — good. But if the same contact appears in 2 campaigns, the modal shows them as eligible in both even after sending — because `campaign_contacts.stage` is per-campaign only; there's no cross-campaign throttle/warning.

### B8. Activation gate doesn't check timing
Activation requires all 4 strategy flags. But you can activate a campaign whose **start_date is in the future** with no warning — and the Send Email button on Monitoring will then 400 because outreach is gated by `isWithinTimingWindow()`. The user sees no message saying "Wait until start date".

### B9. Send Email modal lets you send to contacts whose region isn't in the campaign region list
TEST contacts have `region = "EU"`. Campaign 2 has both EU and Asia. Fine. But if the campaign were Asia-only, the Audience table would hide them while the Email Compose modal (`contactsProp` is the full campaign-contacts array) would still show them. No region cross-check at send time.

### B10. Overview "Engagement Funnel" double-counts
`getOutreachCounts()` mixes thread counts (email) with row counts (call/linkedin). The funnel's `Contacted` cumulative bucket can exceed `Total` when a contact is touched on multiple channels — visually breaks the descending funnel.

### B11. Analytics tab spends bandwidth refetching the same data
`CampaignAnalytics` does its own `campaign-accounts/contacts/communications` queries with different `staleTime` than Overview, so switching tabs triggers re-fetches even though `CampaignDetail` already hydrated them. ~3× duplicated queries.

### B12. Reply detection writes provider-sync rows that can lack `contact_id`
Schema allows `campaign_communications.contact_id` to be NULL. The `getOutreachContactCounts` helper guards with `if (!c.contact_id) return;`, but the dashboard tile counters in `CampaignDashboard` don't — undercounting/overcounting depending on the metric.

### B13. No way to **resend** a failed email from Monitoring
A send that returns `delivery_status: failed` is logged with stage update, but the row is never retried, and there's no "Retry send" button surfaced anywhere.

### B14. Header subtitle (`CampaignDetail.tsx` line 247) uses raw `campaign.campaign_type`
Skips `campaignTypeLabel()`, so types like `"new_outreach"` show un-prettified.

---

## 🟡 Layout / UX issues

| # | Where | Issue |
|---|---|---|
| L1 | `CampaignDetail` header (line 245) | Title `text-sm` is too small vs other modules' `text-xl`. Subtitle truncates on narrow screens. |
| L2 | Tabs (line 336) | `h-8`, `text-xs`, no active-state pill — looks faded next to Deals/Contacts which use `h-10`. |
| L3 | Strategy sections | All 4 use the same blue header (`unifiedStyle`). Color variety would aid scanning (Region=blue, Audience=emerald, Message=purple, Timing=amber) and matches the rest of the app's color language. |
| L4 | Strategy "Mark done" check icon | Uses tiny circle — easy to miss. Better: full-width "Mark Done" button in the section's open state. |
| L5 | Audience table | Add Account button is in the toolbar; Add Contacts is hidden inside an account row's action menu — discoverability poor. |
| L6 | AddAccounts modal | Doesn't show region/country mismatch warnings; no "this account has 0 contacts" hint until expanded. |
| L7 | Message step | 3 sub-tabs (Email / Phone / LinkedIn) with no "what's required" badge — users hit "Mark Done" then get a blocking toast. |
| L8 | Timing step | Doesn't show a calendar visualisation of windows; just a list. |
| L9 | EmailCompose | "Bulk" mode hides the per-recipient preview by default — users send blind to N people. |
| L10 | Monitoring email tab | Status filter chips ("All / Sent / Replied / Failed / Bounced") have no counts; have to read each row. |
| L11 | Communications row expand | Replies and originals share one row; no visual gutter showing direction (in/out arrow). |
| L12 | Analytics | KPI tiles are large but the funnel + heatmap below scroll past the fold on a 1080p screen — needs collapsible "advanced metrics" section. |
| L13 | Overview | `Quick start` empty-state reuses small icons; doesn't match the app-wide empty-state pattern with full-card illustration + CTA. |
| L14 | Whole module | No keyboard shortcut hints in any of the sub-tab toolbars (the list view has them; detail view doesn't). |

---

## ✨ Functional improvements

### F1. Region: write **both** the JSON blob AND `country`/`region` scalar columns
Update `CampaignRegion.handleSave()` to also `update({ country: cards[0].country, region: <json> })` so the legacy single-value consumers still work.

### F2. Audience completeness: validate on **reachable contacts on primary channel**
`validateSection("audience")` should additionally enforce: `at least 1 contact has the primary channel reachable (email/phone/linkedin)`. Use `isReachableEmail/Phone/LinkedIn` helpers.

### F3. AddContactsModal: case-insensitive + fuzzy company match
Replace the strict `company_name === account_name` filter with a normalize-and-trim match (strip ", HQ, …" suffixes, lower, trim) so contacts attached to "Eberspaecher" join its account.

### F4. Activation gate adds **start-date check**
In `CampaignDetail.handleStatusChange`, when activating, if `start_date > today`, show toast: "Campaign starts on DD MMM. Activating will queue it; sends will be blocked until then."

### F5. Send Email modal — recipient region cross-check
Filter `contactsProp` by `selectedRegions` from the campaign before showing in Email Compose. Show a small banner: "Hidden N contacts whose region isn't in this campaign's scope."

### F6. Status filter chips with counts on Monitoring
`Sent (12) · Replied (3) · Failed (1) · Bounced (0)` — derive from already-loaded comms.

### F7. Engagement Funnel — cumulative model with row-count clamp
On Overview, change `getOutreachCounts` to ensure `Contacted ≤ Total` by counting **unique contact_ids touched on any channel**, not summing channels.

### F8. "Retry failed send" button in Monitoring email rows
For rows with `delivery_status === 'failed'`, add a small `RotateCw` button → re-invokes `send-campaign-email` with the same payload.

### F9. Lift fetch for accounts/contacts/communications to `CampaignDetail`
`CampaignAnalytics` and `CampaignOverview` should accept these as props (already does for Overview). Remove duplicate queries in `CampaignAnalytics`.

### F10. Strategy color & layout polish
- Region: blue · Audience: emerald · Message: purple · Timing: amber
- Open section adds a footer-bar "Mark as Done" button (full width, tinted)
- Validation hint shown inline (under the section header) so users know what's required before clicking

### F11. Header polish (CampaignDetail)
- Title `text-xl font-semibold`
- Subtitle uses `campaignTypeLabel()`, shows owner avatar + name
- Tabs `h-10`, `text-sm`, active state with a primary background pill

### F12. Empty-state polish
- Audience with 0 accounts → big "Add your first account" card with CTA
- Message with 0 templates → tabbed empty state with "Use AI to draft" CTA
- Monitoring with 0 sent → "Send your first email" CTA that opens compose

### F13. Add "Eligible recipients" mini-summary on Monitoring
Above the status chips: `12 contacts · 9 reachable on email · 3 not contacted`. Click → filters table.

### F14. Cross-campaign throttle warning
When sending email to a contact who already received a campaign email in the last 7 days (any campaign), show an amber "Recent contact" tag in the recipient picker.

---

## 🛠 Files to edit

| File | Changes |
|---|---|
| `supabase/functions/email-skip-report/index.ts` | **Fix build:** wrap pdfBytes in `Blob` or cast as `BodyInit` |
| `src/components/campaigns/CampaignModal.tsx` | Add Region quick-picker (multi-region) + Tags input + Notes |
| `src/components/campaigns/CampaignRegion.tsx` | Mirror first card to `campaigns.country/region` scalar |
| `src/components/campaigns/CampaignStrategy.tsx` | Per-section colors, footer "Mark Done" button, inline validation hint |
| `src/components/campaigns/CampaignStrategy.tsx` (validate) | F2: reachable-on-primary-channel check |
| `src/components/campaigns/AddContactsModal.tsx` | F3: fuzzy company match (normalize) |
| `src/pages/CampaignDetail.tsx` | F4 + F11: activation start-date gate, header polish, tabs `h-10/text-sm`, fix `campaignTypeLabel` |
| `src/components/campaigns/EmailComposeModal.tsx` | F5 + F14: region cross-check banner; recent-contact tag |
| `src/components/campaigns/CampaignCommunications.tsx` | F6 + F8 + F13: counts on chips, retry button, eligible summary |
| `src/components/campaigns/overviewMetrics.ts` | F7: unique-contact cumulative funnel |
| `src/components/campaigns/CampaignAnalytics.tsx` | F9: accept already-fetched data via props (or rely on shared queryKeys, no refetch) |
| `src/components/campaigns/CampaignAudienceTable.tsx` | L5: hoist "Add Contacts" to a primary toolbar button next to "Add Accounts" |
| `src/components/campaigns/CampaignTiming.tsx` | L8: add a 30-day mini calendar showing windows |

## Out of scope
- Database schema changes (the data model is fine).
- Reply-detection edge function logic (already heavily tuned).
- Removing/renaming any tabs.

