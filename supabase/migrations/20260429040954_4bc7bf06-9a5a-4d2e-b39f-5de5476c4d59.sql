-- Stitch existing inbound graph-sync replies back to their parent thread by
-- backfilling the References header and a stable thread_root_id from parent_id.
-- Required because cross-mailbox bridges (Gmail↔Outlook) rotate conversationId
-- and historical reply rows were inserted with NULL `references`, leaving the
-- UI thread bucketer unable to stitch them.
UPDATE public.campaign_communications c
SET "references" = p.internet_message_id,
    thread_root_id = COALESCE(p.thread_root_id, p.id)
FROM public.campaign_communications p
WHERE c.parent_id = p.id
  AND c.sent_via = 'graph-sync'
  AND c."references" IS NULL
  AND p.internet_message_id IS NOT NULL;