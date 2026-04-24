## Remove Reply Health Tab + Verify Reply Threading & Analytics

### Why remove Reply Health
The Reply Health tab is a diagnostic/admin view of the safety guards that decide whether an inbound email is attached to a campaign or rejected. For an end-user campaign workspace this is noise:
- The KPIs ("Skipped replies", "Active guards", "Skip rate") only make sense to an engineer triaging missed replies.
- Top offending senders / conversations duplicate what `Settings → Email skip audit` already shows (admin-only).
- All the meaningful numbers users care about (Sent, Replied, Reply rate, Bounced, Opened) already exist in **Monitoring → Analytics**.

So: remove the tab from the campaign detail page. Keep the admin audit page at `/settings/email-skip-audit` for engineers; drop the in-tab dashboard.

### Verify "all replies attach to the correct thread"
This already works correctly today via `check-email-replies` (Microsoft Graph poller). Confirmed by reading `supabase/functions/check-email-replies/index.ts` and `CampaignCommunications.tsx`:

- Every outbound `campaign_communications` row stores Graph `conversation_id` + `internet_message_id`.
- The poller fetches inbound mail per mailbox, groups by `conversation_id`, applies four guards (chronology, subject compatibility, contact match, ambiguity), and on success inserts an inbound row with the SAME `conversation_id`, `parent_id = original_email.id`, and `sent_via = "graph-sync"`.
- The Monitoring view groups messages by `conversation_id + contact_id`, so the inbound row appears under its outbound parent thread automatically.

No code change is needed for threading — it's already correct. The skip log only records replies the guards rejected (e.g. an out-of-order autoreply on a recycled thread), which by design should NOT be attached.

### Verify "all analytics under Analytics"
`CampaignAnalytics.tsx` (Monitoring → Analytics toggle) already surfaces:
- Sent, Delivered, Bounced, Opened, **Replied**, **Reply Rate**, Open Rate
- Inbound conversation count (used as the reply fallback)
- Funnel: Contacted → Responded → Qualified → Converted

Nothing about valid replies is hidden in Reply Health that isn't already in Analytics. Removing the tab does not lose user-facing data.

### Fix unrelated build error
The build is currently broken on `supabase/functions/email-skip-report/index.ts:223` (Deno type-check rejects `Uint8Array` as `BodyInit`). One-line fix:

```ts
return new Response(pdfBytes as BodyInit, { ... });
```
or
```ts
return new Response(new Blob([pdfBytes], { type: "application/pdf" }), { ... });
```

This needs to be fixed regardless; it's blocking deploys. The PDF report is still reachable from the Settings → Email skip audit page, so the fix keeps that working.

### Files

| File | Change |
|---|---|
| `src/pages/CampaignDetail.tsx` | Remove `replyHealth` `<TabsTrigger>`, `<TabsContent>`, and the `ReplyHealthDashboard` lazy import. |
| `src/components/campaigns/ReplyHealthDashboard.tsx` | Delete (no other importers). |
| `supabase/functions/email-skip-report/index.ts` | Cast `pdfBytes` to fix the Deno `BodyInit` type error. |

### Kept (admin-only, unchanged)
- `/settings/email-skip-audit` route + `EmailSkipAuditTable` — still available for admins who need to investigate why a specific inbound was rejected.
- `email_reply_skip_log` table and `check-email-replies` guard logic — unchanged; threading correctness depends on it.
