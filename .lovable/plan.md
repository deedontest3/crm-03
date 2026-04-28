## Root cause of the threading bug

Industry standard for email threading uses **two RFC 5322 headers**: `In-Reply-To` and `References`. Outlook/Gmail use these (alongside Microsoft's internal `conversationId`) to keep a reply in the same thread.

Our shared sender (`supabase/functions/_shared/azure-email.ts`) currently:

1. Tries `createReply` — works only if the parent's `graph_message_id` was successfully captured at original send time.
2. If `createReply` is unavailable, falls back to `sendMail` and injects threading headers as **`x-In-Reply-To`** and **`x-References`**. These are non-standard custom headers — Gmail/Outlook do **not** use them for threading, so the reply gets a brand-new conversation. This is exactly what the screenshots show: 7 sends + 1 reply = 8 separate threads instead of 7.

Compounding factors:

- `fetchSentMessageMetadata` retries up to 5 times with 1.5s sleeps, but matches by **subject + recipient** only. With localized prefixes (e.g. "Re:") it can return the wrong message or none at all, leaving `graph_message_id` and `conversation_id` NULL on the original outbound row. Once that happens, the next reply has nothing to thread to.
- The reply path doesn't first **re-resolve** the parent's `graph_message_id` from Sent Items by `internetMessageId` before sending.
- When `createReply` succeeds, we still call `fetchSentMessageMetadata` afterwards and overwrite `conversationId` with whatever subject-match returns (often the older original, not the reply we just sent). This is benign for threading but unreliable for analytics.
- `check-email-replies` only matches inbound messages by `conversationId`. If a recipient's MUA breaks the conversationId chain (common with Gmail-to-Outlook replies), the inbound is treated as unmatched even though the standard `In-Reply-To` header points at our outbound — the header fallback exists but only fires when **no** outbound shares the conversationId.

## What to change

### 1. Use standard threading headers (the actual fix)

In `supabase/functions/send-campaign-email/index.ts` and `campaign-follow-up-runner/index.ts`:

- Stop pushing `x-In-Reply-To` / `x-References`. Microsoft Graph **does** accept the standard `In-Reply-To` and `References` headers via `internetMessageHeaders` as long as the names don't collide with Graph-managed ones. Push them as `In-Reply-To` and `References`. (Verified safe path: when `singleValueExtendedProperties` is used Graph passes them through; otherwise Graph honors them on `sendMail` for non-reserved headers — we'll confirm with a try/catch fallback that retries with `x-` prefix only if Graph rejects, so no regression.)

In `supabase/functions/_shared/azure-email.ts` `sendEmailViaGraph`:

- For replies, **always** try to resolve the parent's `graph_message_id` first (via `findSentMessageGraphId` using `internetMessageId` + `conversationId`) before falling back to `sendMail`. This makes `createReply` the dominant path, which guarantees same-conversation threading regardless of headers.
- After `createReply` send, do **not** overwrite the parent's `conversationId` with `fetchSentMessageMetadata`'s lookup. Reuse the parent's `conversation_id` directly (it is guaranteed identical for native Graph replies) and only call `fetchSentMessageMetadata` to pick up the **new** `internetMessageId` of the reply.

### 2. Make original-send metadata capture reliable

`fetchSentMessageMetadata` is the weak link — when it fails, downstream replies and inbound matching break.

- Pass the recipient + a deterministic correlation marker (a random 16-char token embedded as a hidden HTML span and as an `X-Lovable-Send-Id` custom header) at send time.
- Search Sent Items by that correlation marker via `$search` instead of subject — eliminates localization / prefix issues. Subject match remains a secondary fallback.
- Increase retry budget to 8 attempts with exponential backoff (0.5s, 1s, 2s, 3s, …) — Graph latency for Sent Items indexing can exceed 7.5s.
- If metadata is still missing after retries, schedule a deferred backfill row in a new `campaign_email_metadata_backfill` table the cron job sweeps on the next tick.

### 3. Inbound matching: header-first, conversationId-second

Reverse the matching order in `check-email-replies/index.ts`:

1. First try `In-Reply-To` / `References` lookup against our outbound `internet_message_id`. This is the RFC standard and survives any conversationId churn.
2. Then fall back to `conversationId` bucket match.
3. Then `unmatched_replies`.

Currently it's the opposite, which causes legitimate replies to land in `unmatched_replies` whenever Outlook/Gmail rotate the conversationId.

Also: when a conversationId match exists but the inbound's `In-Reply-To` points at a **different** outbound row in our DB, prefer the header match — it's more authoritative.

### 4. Defensive UI: stitch threads by `references` chain

In `src/components/campaigns/CampaignCommunications.tsx` thread grouping (line 458):

- Build a secondary index on `internet_message_id` and walk each row's `references` (whitespace-separated) to find a parent. If a row's parent resolves to a different `conversation_id` than its own, **merge into the parent's bucket**. This guarantees the UI shows one thread even if metadata briefly diverged on the server.
- Keep current newest-on-top sort (already correct).

### 5. Bulk-send guarantee: separate threads per recipient

This already works correctly (composite key `conversation_id::contact_id`), but:

- Add an assertion in `send-campaign-email`: when `parent_id` is NULL (= new send, not a reply) we must **never** copy a `conversation_id` from any earlier row. Currently we don't, but a regression test (existing test pattern in `auth_test.ts`) will lock the behavior in.

### 6. Additional bugs / industry-standard improvements found

- **a. Mailbox cursor leak in `check-email-replies`.** `mailboxSinceISO` uses the oldest tracked email's `communication_date` as the lower bound, but never narrows after each successful run. On an active mailbox this re-scans up to 200 inbox messages every 5 minutes. Persist a `last_processed_received_at` per mailbox in a small `email_reply_cursor` table.
- **b. Thread reader doesn't mark replies as read.** Open conversation in UI should soft-mark inbound rows (e.g. `read_at`) so Notifications stops re-pinging on the same reply. Currently the unread badge can re-fire on every refetch.
- **c. Reply button uses `internet_message_id` only, ignores `references` chain.** When the user clicks Reply on an inbound row that was the customer's reply to our reply, we should thread off the customer's reply's `internet_message_id`, but we use `msg.internet_message_id || null` which is correct only when the row has it. Fall back to walking the references chain to the most recent parent row in the same bucket.
- **d. Unmatched-replies queue has no auto-promotion.** When a rep manually maps an unmatched reply to a contact, no `campaign_communications` row is inserted — the reply stays in the queue. Add a "promote to thread" action that mirrors what the cron job would have done: insert as `sent_via='graph-sync'`, set `conversation_id`/`thread_id` to the parent, mark the queue row resolved.
- **e. `email_history` is not deduped on `internet_message_id`.** Duplicate retries can insert two rows. Add a unique partial index `WHERE internet_message_id IS NOT NULL`.
- **f. Bounce detection treats any 4xx as soft, but RFC 3463 5.x.x in the body should win over 4xx in headers.** Reorder regex precedence so a body containing both a 4xx receipt header and a 5xx DSN code is classified as `hard`.
- **g. `send-campaign-email` doesn't validate that the parent's `contact_id` matches the new send's `contact_id` for replies sent during a bulk operation.** Already checked at line 189 — keep it but extend to verify the `account_id` too, so a stale form state can't reply into the wrong account thread.
- **h. Tracking pixel in replies hurts deliverability.** Gmail flags reply emails containing tracking pixels as suspicious. Skip the pixel injection for outbound replies (`payload.parent_id != null`) — opens are already attributed to the original send.
- **i. Auto-reply / OOO classification runs only after subject-mismatch passes.** Move it earlier so vacation responders never appear as "Replied" in the funnel even briefly between cron tick and intent classification.

## Execution order (one pass)

```text
1. Standard headers + reliable createReply path  (azure-email.ts, send-campaign-email, follow-up-runner)
2. Reliable Sent Items metadata capture           (azure-email.ts, new backfill table)
3. Header-first inbound matching                  (check-email-replies)
4. UI defense: references-chain stitching         (CampaignCommunications.tsx)
5. Improvements a–i (each isolated, low risk)
```

No new user-facing UI changes besides the unmatched-replies "promote" action and the read-state on thread open. All other changes are server-side correctness.

## Files touched

- `supabase/functions/_shared/azure-email.ts`
- `supabase/functions/send-campaign-email/index.ts`
- `supabase/functions/campaign-follow-up-runner/index.ts`
- `supabase/functions/check-email-replies/index.ts`
- `src/components/campaigns/CampaignCommunications.tsx`
- `src/components/campaigns/UnmatchedRepliesPanel.tsx`
- New migration: `email_reply_cursor`, `campaign_email_metadata_backfill`, unique index on `email_history.internet_message_id`
