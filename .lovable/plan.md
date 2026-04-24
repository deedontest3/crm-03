## Campaign Module — Industry-Standard Compliance Audit & Plan

This plan maps the spec sections (1–14) to the current implementation, lists concrete gaps/bugs, and proposes only the changes needed to bring the module to industry standard. Nothing is rebuilt that already works.

---

### 1. Compliance Matrix (current state)

| # | Spec area | Status | Notes |
|---|-----------|--------|-------|
| 1–2 | Campaign definition / core structure | OK | `campaigns` has goal, audience, message, region, timing |
| 3 | Audience = Accounts + Contacts, segmented | Partial | Account/Contact link works, but segmentation is only by region/country. No persona/role/industry/size filter at the campaign level (`campaign_audience_personas` table exists but isn't wired into the audience picker) |
| 4 | Multi-template, per-segment messaging | Partial | Templates exist with `audience_segment` & `email_type` columns but the compose flow doesn't filter templates by the recipient's segment automatically |
| 5 | Multi-channel (Email/Call/LinkedIn) | OK | All three channels logged in `campaign_communications` |
| 6 | Email lifecycle + threading + reply mapping | Mostly OK | Sent / Bounced / Replied tracked. Open tracking exists. **Bug:** "Delivered" is computed as `sent − bounced` (not a true delivery event). **Gap:** no per-thread "last activity" surface in the contact row |
| 7 | Follow-ups (manual + automated, stop on reply, same thread) | **BROKEN** | `campaign-follow-up-runner` inserts a `Queued` row with `sent_via='follow_up_automation'` but **no edge function ever picks those rows up and dispatches them via Graph**. Follow-ups are silently never sent. Cron is firing hourly into a dead-end |
| 8 | Timing — stop after end date | OK | Auto-completes on end-date; outbound UI disabled when ended |
| 9 | Status flow Not Contacted → Contacted → Responded → Qualified | OK | But no automatic transition from "inbound reply received" → contact stage `Responded`. Today this is manual |
| 10 | Tasks linked to campaign/account/contact | Partial | `action_items.module_type='campaign'` works, but follow-up actions aren't auto-generated when a reply arrives |
| 11 | Convert to Deal at Lead stage, link account+contact+campaign | OK | `handleConvertToDeal` creates deal at `stage='Lead'` with `campaign_id` + `source_campaign_contact_id` |
| 12 | Analytics — channel/template/segment performance | Partial | Channel + reply rate covered. **Template performance and A/B variants UI exists but segment-performance breakdown is missing** |
| 13 | Data integrity (one account per contact, no orphans, no duplicate convs) | Partial | Contacts can exist without `account_id`; no UNIQUE on `(campaign_id, contact_id)` in `campaign_contacts` (duplicates possible) |
| 14 | Traceability / interaction logging | OK | `email_reply_skip_log` + `campaign_communications` give full trace |

---

### 2. Bugs / High-Priority Fixes

**B1. Follow-up automation is a dead loop.** `campaign-follow-up-runner` enqueues rows into `campaign_communications` but no consumer dispatches them. Result: zero follow-ups have been sent (DB confirms 19 emails, 0 with `sent_via='follow_up_automation'` actually delivered).
- Fix: extend the runner (or a new `campaign-follow-up-dispatcher`) to call `send-campaign-email` per queued row, using the rule's `created_by` as the sender. Re-use the existing thread by passing `conversation_id` + `internet_message_id` of `follow_up_parent_id` so Graph keeps the thread.
- Stop-condition already correct (skip if `delivery_status='received'` exists).

**B2. Inbound reply doesn't bump contact stage.** When `check-email-replies` writes an inbound row, `campaign_contacts.stage` for that contact stays at whatever it was.
- Fix: in `check-email-replies`, after a successful inbound insert, `UPDATE campaign_contacts SET stage='Responded' WHERE campaign_id=$ AND contact_id=$ AND stage IN ('Not Contacted','Email Sent','Phone Contacted','LinkedIn Contacted')`. Account status is already auto-derived from contacts.

**B3. "Delivered" metric is misleading in Analytics.** Currently `delivered = sent − bounced`. There's no Graph delivery webhook here, so we should either rename the tile to "Accepted" or remove the row to avoid confusion.
- Fix: rename label to "Accepted (no bounce)" in `CampaignAnalytics.tsx` and add a tooltip explaining no delivery receipt is captured.

**B4. Duplicate campaign_contacts possible.** No DB unique constraint on `(campaign_id, contact_id)`. The Add Contacts modal does an in-app check but a race or import bypasses it.
- Fix: migration adding `UNIQUE (campaign_id, contact_id)` and `UNIQUE (campaign_id, account_id)` on `campaign_accounts`.

**B5. Orphan contacts in audience.** A `campaign_contacts` row can have `account_id IS NULL`, violating spec §3 "Contacts must belong to Accounts".
- Fix: when adding a contact whose source `contacts.company_name` matches no `accounts` row, auto-create the account (this already exists for some flows — extend it to `AddContactsModal` add path).

**B6. Cron runner with no FK guarantees.** The follow-up runner doesn't filter by campaign status — a Paused/Completed campaign can still queue follow-ups.
- Fix: add `.eq("campaigns.status", "Active")` join filter in the runner.

---

### 3. Missing Capabilities (per spec)

**M1. Segment-aware audience selection (§3).**
Wire `campaign_audience_personas.criteria` JSON (role/industry/geo/company size keys) into `AddContactsModal`/`AddAccountsModal` as a "Filter by persona" dropdown. Picking a persona pre-filters the result list before the user chooses.

**M2. Segment-aware template selection (§4).**
In `EmailComposeModal`, when a recipient is selected, sort templates so those whose `audience_segment` matches the contact's persona/region appear first. Pure UX — no schema change.

**M3. Auto-create follow-up tasks on reply (§10).**
When `check-email-replies` inserts an inbound row, also insert an `action_items` row: `{ module_type:'campaign', module_id: campaign_id, title: 'Reply received from {contact} — respond', priority:'High', due_date: today+1 }` (skip if one already exists open for the same contact in the last 24h).

**M4. Segment-performance widget (§12).**
Add a small "Performance by segment" table to `CampaignAnalytics.tsx` (Region / Industry already partly computed at lines 427/438). Surface reply-rate per segment alongside the existing volume bars.

**M5. Last-activity column on audience table (§6 traceability).**
Add a "Last touch" column to `CampaignAudienceTable` rows showing the most recent communication date + channel icon. Pulled in one extra query keyed by `campaign_id` aggregating max(`communication_date`) per `contact_id`.

---

### 4. File-by-File Change List

| File | Action | Purpose |
|---|---|---|
| `supabase/functions/campaign-follow-up-runner/index.ts` | Modify | After inserting the queued row, immediately invoke `send-campaign-email` with the parent's thread context so Graph reply-chains it. Filter rules to active campaigns only. |
| `supabase/functions/check-email-replies/index.ts` | Modify | After successful inbound insert: (a) bump `campaign_contacts.stage` to `Responded`, (b) create a follow-up `action_items` row if none open. |
| `supabase/migrations/<new>.sql` | Create | `UNIQUE (campaign_id, contact_id)` on `campaign_contacts`; `UNIQUE (campaign_id, account_id)` on `campaign_accounts`. Wrap in `ON CONFLICT DO NOTHING` cleanup of any existing dupes first. |
| `src/components/campaigns/CampaignAnalytics.tsx` | Modify | Rename Delivered → "Accepted (no bounce)" with tooltip; add Segment Performance table (region + industry rows). |
| `src/components/campaigns/AddContactsModal.tsx` | Modify | Add persona-filter `Select` populated from `campaign_audience_personas`. |
| `src/components/campaigns/AddAccountsModal.tsx` | Modify | Same persona-filter dropdown. |
| `src/components/campaigns/EmailComposeModal.tsx` | Modify | Sort templates so those matching recipient's `region` / persona appear first; show a "matches segment" badge. |
| `src/components/campaigns/CampaignAudienceTable.tsx` | Modify | New "Last touch" column (date + channel icon); driven by an aggregate query. |
| `src/components/campaigns/CampaignAccountsContacts.tsx` | Modify | When adding a contact with a `company_name` not matching an account, auto-create the account before linking (parity with import flow). |

No new top-level pages, no rewrite of working tabs.

---

### 5. Out of Scope (kept as-is)

- Overview, Setup, Monitoring, Action Items tab structure
- Existing Email Compose / AI Draft / A-B variant workflows
- Existing Microsoft Graph integration
- Reply Health tab (already removed last turn)

---

### 6. Risk Notes

- The follow-up dispatcher fix (B1) will start sending real emails on the hourly cron as soon as it deploys. We will gate the new send call behind a `campaign_settings` flag `follow_ups_enabled` (default `false` for safety) so the user explicitly turns it on after reviewing rules.
- Adding UNIQUE constraints (B4) requires a one-time dedupe; the migration includes a `DELETE … USING` step keyed on `created_at` (oldest kept).
