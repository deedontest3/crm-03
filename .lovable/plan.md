

# Campaign workflow audit — bugs found and fixes

I walked the workflow end-to-end (create → 4-step Setup → Monitoring/send → Analytics/Reply Health) against your live data. Below is what's broken or off, grouped by severity, plus the concrete fix for each.

---

## 1. Critical — runaway "chronology" skip-log spam

**What I see in the database**
- `cron.job` `check-email-replies-every-5-min` runs `*/5 * * * *`.
- `email_reply_skip_log` already has 15 rows, **all** `skip_reason='chronology'`, **all** for the same Lukas reply (`Re: Boosting Realthingks's Growth in EU`, conversation `…AAAQAEWrowezDMtNpHcsPI-wXZ4=`), inserted every 5 minutes since 05:45 UTC.
- The reply legitimately belongs to **Campaign 1** ("test 1") where contact Lukas was sent that exact subject at 11:20:26 — and a valid graph-sync row already exists for it. But on every cron tick the function also evaluates **Campaign 2** ("Campaign 2"), which sent a different subject (`Boosting Automotive Virtualization at Realthingks`) to the same contact at 03:56 today. Outlook re-uses the same `conversationId` for both, the bucket-resolver picks Campaign 2 first, the chronology gate fails (reply pre-dates the Campaign 2 outbound), and a new skip row is written.

**Two bugs combined**
- The function never deduplicates against the skip log — it re-inserts the same `(conversation_id, internet_message_id, skip_reason)` row every run.
- Bucket selection inside `check-email-replies` uses `bucketsByConvId.get(msg.conversationId)` returning candidate keys across **all campaigns**, then ranks by "newest outbound". When the same contact has older sent emails in another campaign with the same conversation_id, the wrong campaign wins.

**Fix**
- In `supabase/functions/check-email-replies/index.ts`, before calling `logSkip(...)`, check whether an identical row already exists (`internet_message_id + skip_reason`) and skip the insert if it does.
- Tighten bucket scoring: prefer buckets where the **parent's `internet_message_id` appears in the reply's `Graph in-reply-to` chain**, then by subject compatibility, then by chronology. Only after all of these fail should chronology be logged.
- Add a unique index `email_reply_skip_log_dedupe_idx` on `(conversation_id, sender_email, skip_reason)` with `WHERE conversation_id IS NOT NULL` so duplicate inserts are no-ops at the DB layer too.

---

## 2. Critical — Re-sync result is always "0 inserted" when scoping by contact

`runResync(contactScope)` derives `contactScope` from the open thread's composite key, which is always `<conversation>::<contactId-of-the-bucket-shown>`. When you open the orphan/skipped thread under Campaign 2 and click **Re-sync replies**, the function gets `contact_id = b896c4d8-…` (Lukas in Campaign 2's bucket), but Campaign 2 has no Lukas outbound matching the reply's subject, so the result is always `inserted: 0`.

**Fix**
- After `runResync` finishes, if `inserted === 0` and `skipped.subject_mismatch + skipped.chronology > 0`, automatically retry **without** `contact_id` (campaign-scope only) and surface a single combined result.
- In the result dialog, when `correlation_id` is present, always render the "View skipped replies" deep-link even if `inserted > 0`, and show the per-reason counts as filter chips.

---

## 3. High — Two competing React-Query keys for the same campaign data

`CampaignAudienceTable` uses `["campaign-audience-accounts", campaignId]` and `["campaign-audience-contacts", campaignId]`, while `CampaignAccounts`, `CampaignContacts`, `CampaignAnalytics`, `useCampaignDetail`, and `EmailComposeModal` use `["campaign-accounts", campaignId]` / `["campaign-contacts", campaignId]` (sometimes with a `"detail"` / `"analytics"` / `"monitoring"` suffix, sometimes not).

Removing a contact from the Audience tab invalidates the `audience-*` key but not the `campaign-contacts` keys, so:
- Setup → Audience shows the contact gone.
- Setup → Audience contact-counter (passed via `contentCounts.contactCount` from `useCampaignDetail`) still shows the old number until a hard refresh.
- Monitoring → email recipient dropdown still lists the removed contact.

**Fix**
- Consolidate to one canonical key per dataset: `["campaign-accounts", campaignId]` and `["campaign-contacts", campaignId]`. Drop the `"detail"`, `"analytics"`, `"monitoring"`, `"audience"` suffixes — they all hit the same table; differentiate via `select` only.
- Update `CampaignAudienceTable` realtime handler and remove modal to invalidate the canonical keys.
- In `useCampaignDetail`, broaden `select(...)` to include the columns Audience needs so we never have to keep two separate fetches.

---

## 4. High — Audience account-status logic disagrees with itself

Two functions compute "account status from contacts" in slightly different ways:
- `CampaignAccounts.tsx` → returns `Deal Created` when any contact's stage is `Qualified`.
- `CampaignContacts.tsx::deriveAccountStatus` → same, but `recomputeAccountStatus` writes the value back to `campaign_accounts.status`.
- The reactivity is one-way: `CampaignAccounts` derives on the fly and ignores the persisted `status`, while every other place reads `campaign_accounts.status`.

Result: stage `Converted` (used in Analytics' funnel) is treated differently from `Qualified` (used here). When an admin marks a contact `Converted`, the account stays `Responded`.

**Fix**
- Move `deriveAccountStatus` into a single helper `src/utils/campaignStatus.ts` and make both files import it.
- Treat both `Qualified` and `Converted` as `Deal Created` everywhere.
- Make `CampaignAccounts` always read `ca.status` from the DB row (since `recomputeAccountStatus` keeps it fresh) and only derive on the fly when `ca.status` is null.

---

## 5. High — Campaign Modal "Edit" navigation in the list page

In `src/pages/Campaigns.tsx`, opening the Edit modal works from the row, but the `Actions ▸ Edit` button on the campaign detail page calls `setEditOpen(true)` while the modal already has a stale `campaign` prop bound at mount. If you switch to a different campaign without unmounting the page (very rare but possible via prefetch), the modal shows the wrong campaign for one render. More importantly, the "duplicate name" check in `CampaignModal.checkDuplicateName` uses `ilike(campaign_name, trimmed)` — this matches partial names containing wildcards (`%`, `_`) typed by the user, throwing false positives.

**Fix**
- In `CampaignModal`, escape `%` and `_` before calling `ilike`, or switch to `eq` since names are user-visible exact strings now.
- Add a `key={campaign?.id || "new"}` on `<CampaignModal>` in both pages so React fully remounts on identity change.

---

## 6. High — Setup → Region progress count is wrong for legacy data

`CampaignStrategy` computes `regionCount` inline:
```ts
try { const arr = JSON.parse(campaign.region || ""); return Array.isArray(arr) ? arr.length : 0; } catch { return campaign.region ? 1 : 0; }
```
But `parseSelectedRegions` upstream already dedupes on `r.region` — so a campaign with two countries inside one region (e.g. `[{region:"EU", country:"DE"}, {region:"EU", country:"FR"}]`) reports `regionCount = 2`, while the validator and the Region tab show "1 region". The "Mark Region as done" gate then succeeds when there's only 1 region, which is fine, but the badge reads "2/4 → 3/4" inconsistently.

**Fix**
- Reuse `parseSelectedRegions(campaign.region).length` as the canonical count. Move the helper into `src/utils/campaignRegion.ts` and import in both places.

---

## 7. Medium — `CampaignContacts` fetches contacts without `contact_owner` for RLS preview

The Add Contacts modal (`AddContactsModal.fetchAllContacts`) selects `id, contact_name, email, position, company_name, phone_no, linkedin` — fine for non-admins because RLS on `contacts` only returns rows where `created_by = auth.uid()` OR `contact_owner = auth.uid()`. So **a non-admin user sees only their own contacts** when trying to add to a shared campaign, even though the campaign is shared. The Audience table then silently shows fewer contacts than the count in the global Contacts module.

**Fix**
- Add an explanatory empty-state in the modal: "Showing only contacts you own. Ask the contact owner to share or transfer to make them targetable."
- Optional: introduce a `can_view_contact_for_campaign(...)` security-definer function so campaign collaborators can target contacts they don't own.

---

## 8. Medium — Reply Health PDF download is broken in browsers

`ReplyHealthDashboard.downloadPdf` does:
```ts
const { data } = await supabase.functions.invoke("email-skip-report", { body: ... });
const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: "application/pdf" });
```
`supabase.functions.invoke` parses the body based on `Content-Type`. The edge function returns `application/pdf` so `data` is already an `ArrayBuffer`/`Blob`, but in some cases (e.g. when CORS pre-flight strips Content-Type) the SDK falls back to `text/plain` and returns a corrupted string. The user gets a "PDF failed" toast or a 0-byte file.

**Fix**
- Switch to a direct `fetch` against `${VITE_SUPABASE_URL}/functions/v1/email-skip-report` with an `Authorization: Bearer ${anonKey}` header, then `await resp.blob()`. Apply the same fix in `EmailSkipAuditTable.downloadPdf`.

---

## 9. Medium — Email Compose modal doesn't enforce the campaign's primary channel

`EmailComposeModal` happily lets you bulk-send to contacts even when `campaign.primary_channel = 'LinkedIn'` or `Phone`. There is no warning. Combined with the missing "audience reachable" guard, this leads to mixed-channel logs that pollute Analytics' channel-mix donut.

**Fix**
- When `campaign.primary_channel` is set and ≠ `Email`, show an inline yellow banner at the top of the modal: *"This campaign's primary channel is {channel}. Are you sure you want to send email instead?"* with a "Continue anyway" toggle that must be enabled before Send is allowed.

---

## 10. Medium — `parseSelectedRegions` ignores legacy single-string regions

`CampaignStrategy.parseSelectedRegions` only returns regions when `JSON.parse(raw)` returns an array. For older campaigns where `region = "EU"` (plain string), the function returns `["EU"]`, but the inner `parseSelectedRegions` in `CampaignAudience.tsx` returns `[]` because the JSON parse throws. So the Audience filter applied for those campaigns is empty and shows all contacts globally, ignoring region targeting.

**Fix**
- Make both helpers identical; default to `raw && !raw.startsWith("[") ? [raw] : []` for the non-JSON path.

---

## 11. Medium — Send Email button is hidden when `viewMode = analytics`

In `CampaignCommunications`, the toolbar conditionally renders Send Email and Log Activity (`showSendEmail`, `showLogActivity`). When the user navigates from Overview "Open replies → monitoring → analytics", they are stuck on Analytics with no way to send a reply without first toggling back to Outreach. The toggle is far right and discoverable, but it's still a UX dead-end if the screen is narrow and the toggle wraps.

**Fix**
- Always render the Send Email / Log Activity buttons; only the channel-table area should switch between Outreach and Analytics.

---

## 12. Low — Misc UI / behavioural papercuts

- `CampaignAccounts.tsx` "Open" icon navigates to `/accounts` (full list) instead of `/accounts/{id}` — clicking the link loses context. Switch to the account detail route or open the AccountModal in view mode.
- `CampaignTiming.tsx` accepts `start_date >= end_date` for windows (only the parent campaign blocks this). Add the same `>=` check on the windows form.
- `CampaignModal.tsx` "Owner" dropdown uses an empty-string value when there are no profiles loaded yet, which Radix Select rejects in dev builds (`SelectItem` requires non-empty value). Fall back to a single placeholder item with `value={user.id}` (already handled, but the surrounding Select prop is `value=""` initially — set initial state to `user.id` instead).
- `useCampaigns.cloneCampaign` clones email templates and accounts but **not** the `campaign_timing_windows` and `campaign_follow_up_rules`. Cloning a fully-configured campaign loses these and the "Strategy 4/4" badge becomes misleading.
- `CampaignAnalytics` `funnel` deduplicates "Deal Created ≤ Qualified" but doesn't handle "Qualified ≤ Responded" when Responded is computed from contact stage. With your test data `responded.length = 1` but `qualified = 1` too — both stages are equally high. Add the same monotonic guard at every step (already done — verify nothing has shifted after the cleanup above).
- `CampaignDetail` has a "Reply Health" tab AND a "Monitoring → Analytics" toggle that both pull similar data. Consider folding Reply Health into a sub-tab of Monitoring to reduce top-level tab count.
- The detail header status dropdown does not show the "Activate" warning when start date is in the future and shows it elsewhere — the AlertDialog body has the warning, but when you click "Activate" from the dropdown it still proceeds without confirmation. Verify `setActivateOpen(true)` is gating in all paths.

---

## 13. Test data observations

- Account **TEST** (id `0a8140b0-…`) is correctly set: region=Asia, country=India. It has no phone — Audience will show "no phone" amber dot for any contacts in it that also lack a phone.
- Contacts **Test 1 lukas schleicher** and **Test 2 Lukas Schleicher** (`f617dd33-…`, `e2439f53-…`) have `company_name="TEST"`, `region=EU` — but the TEST account is region=Asia. The Audience country filter (Asia) will hide them. To complete your end-to-end flow: edit the contacts to `region=Asia` or change the campaign region to include EU.
- Both contacts have email but no LinkedIn or phone — only the Email channel is reachable (matches Campaign 2's `primary_channel=Email`).

---

## Implementation order (when you approve)

1. Fix `check-email-replies` skip-log dedup + bucket scoring (#1) + DB unique index migration.
2. Fix Re-sync auto-fallback and result deep-link (#2).
3. Consolidate React-Query keys in detail/audience/monitoring/analytics (#3).
4. Unify `deriveAccountStatus` and `regionCount` helpers (#4, #6, #10).
5. Fix duplicate-name `ilike` escape, modal `key`, clone completeness (#5, #12 sub-items).
6. Fix Reply Health / Audit PDF blob download (#8).
7. Add primary-channel guard to EmailCompose (#9).
8. Always-render Send/Log buttons + account link target (#11, #12).
9. Optional polish: explanatory empty-state in AddContactsModal (#7), fold Reply Health into Monitoring tabs (#12).

No new tables required; one DB migration adds the unique index on `email_reply_skip_log` and a small RPC for safe campaign-scoped contact visibility (only if you want #7 enforced on the server). Everything else is application-level.

