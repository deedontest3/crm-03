-- Normalize bounced campaign communication rows so bounces are not shown as generic send failures.
UPDATE public.campaign_communications cc
SET email_status = 'Bounced',
    delivery_status = 'failed',
    bounced_at = COALESCE(cc.bounced_at, cc.communication_date, now()),
    bounce_type = COALESCE(NULLIF(cc.bounce_type, ''), 'unknown'),
    bounce_reason = COALESCE(NULLIF(cc.bounce_reason, ''), NULLIF(cc.error_message, ''), NULLIF(cc.notes, ''), 'Bounce detected from delivery failure notification')
WHERE cc.communication_type = 'Email'
  AND (
    cc.bounced_at IS NOT NULL
    OR NULLIF(cc.bounce_reason, '') IS NOT NULL
    OR NULLIF(cc.bounce_type, '') IS NOT NULL
  )
  AND COALESCE(cc.email_status, '') <> 'Bounced';

-- Convert inbound non-delivery reports to bounced rows when they were synced as replies.
UPDATE public.campaign_communications cc
SET email_status = 'Bounced',
    delivery_status = 'failed',
    bounced_at = COALESCE(cc.bounced_at, cc.communication_date, now()),
    bounce_type = COALESCE(NULLIF(cc.bounce_type, ''), 'unknown'),
    bounce_reason = COALESCE(NULLIF(cc.bounce_reason, ''), LEFT(COALESCE(cc.body, cc.notes, cc.subject, 'Delivery failure notification'), 500))
WHERE cc.communication_type = 'Email'
  AND cc.sent_via = 'graph-sync'
  AND (
    LOWER(COALESCE(cc.subject, '')) LIKE 'undeliverable:%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE 'undelivered:%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE 'mail delivery failed%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE 'failure notice%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE 'returned mail%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE '%delivery status notification%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE '%could not be delivered%'
    OR LOWER(COALESCE(cc.subject, '')) LIKE '%delivery has failed%'
    OR LOWER(COALESCE(cc.sender_email, '')) ~ '(mailer[-]?daemon|postmaster|microsoftexchange)'
  );

-- Propagate bounce status from synced NDR rows to the matching outbound parent row.
WITH ndr AS (
  SELECT id, conversation_id, contact_id, campaign_id, communication_date, bounce_type, bounce_reason
  FROM public.campaign_communications
  WHERE communication_type = 'Email'
    AND email_status = 'Bounced'
    AND sent_via = 'graph-sync'
    AND conversation_id IS NOT NULL
)
UPDATE public.campaign_communications parent
SET email_status = 'Bounced',
    delivery_status = 'failed',
    bounced_at = COALESCE(parent.bounced_at, ndr.communication_date, now()),
    bounce_type = COALESCE(NULLIF(parent.bounce_type, ''), NULLIF(ndr.bounce_type, ''), 'unknown'),
    bounce_reason = COALESCE(NULLIF(parent.bounce_reason, ''), NULLIF(ndr.bounce_reason, ''), 'Bounce detected from delivery failure notification')
FROM ndr
WHERE parent.communication_type = 'Email'
  AND parent.sent_via <> 'graph-sync'
  AND parent.conversation_id = ndr.conversation_id
  AND (ndr.contact_id IS NULL OR parent.contact_id = ndr.contact_id)
  AND COALESCE(parent.email_status, '') <> 'Bounced';

-- Link email history to campaign communications for future analytics accuracy.
UPDATE public.email_history eh
SET campaign_id = COALESCE(eh.campaign_id, cc.campaign_id),
    campaign_communication_id = COALESCE(eh.campaign_communication_id, cc.id),
    bounce_type = COALESCE(NULLIF(eh.bounce_type, ''), NULLIF(cc.bounce_type, '')),
    bounce_reason = COALESCE(NULLIF(eh.bounce_reason, ''), NULLIF(cc.bounce_reason, '')),
    bounced_at = COALESCE(eh.bounced_at, cc.bounced_at),
    status = CASE
      WHEN cc.email_status = 'Bounced' THEN 'bounced'
      WHEN cc.email_status = 'Failed' AND COALESCE(cc.email_status, '') <> 'Bounced' THEN 'failed'
      ELSE eh.status
    END
FROM public.campaign_communications cc
WHERE eh.internet_message_id IS NOT NULL
  AND cc.internet_message_id = eh.internet_message_id
  AND cc.communication_type = 'Email';

-- Helpful indexes for status filtering and history joins.
CREATE INDEX IF NOT EXISTS idx_campaign_comms_campaign_email_status
  ON public.campaign_communications (campaign_id, communication_type, email_status, delivery_status);

CREATE INDEX IF NOT EXISTS idx_campaign_comms_bounce_lookup
  ON public.campaign_communications (campaign_id, bounced_at, bounce_type)
  WHERE communication_type = 'Email';

CREATE INDEX IF NOT EXISTS idx_email_history_campaign_comm
  ON public.email_history (campaign_id, campaign_communication_id);