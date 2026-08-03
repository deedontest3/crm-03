-- Idempotency safety net for campaign follow-up sends.
-- send_request_id already includes campaign_id, contact_id, step/rule, and template.
-- The runner does a read-then-insert check today; under concurrent invocations both
-- readers can miss the row. This partial unique index closes that race: a second
-- concurrent insert with the same send_request_id (that isn't a 'failed' retry)
-- will hit a 23505 unique violation, which the runner treats as "already sent".
CREATE UNIQUE INDEX IF NOT EXISTS campaign_communications_send_request_id_unique
  ON public.campaign_communications (send_request_id)
  WHERE send_request_id IS NOT NULL AND delivery_status <> 'failed';