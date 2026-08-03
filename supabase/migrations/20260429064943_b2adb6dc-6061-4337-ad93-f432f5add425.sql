
CREATE OR REPLACE FUNCTION public.update_send_job_schedule(
  _job_id uuid,
  _new_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_creator uuid;
BEGIN
  SELECT status, created_by
    INTO v_status, v_creator
  FROM public.campaign_send_jobs
  WHERE id = _job_id
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_creator <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_status NOT IN ('queued','paused') THEN
    RAISE EXCEPTION 'Only queued/paused jobs can be rescheduled (current: %)', v_status;
  END IF;
  IF _new_at IS NULL OR _new_at <= now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'New schedule must be at least 30s in the future';
  END IF;

  UPDATE public.campaign_send_jobs
     SET scheduled_at = _new_at,
         updated_at = now()
   WHERE id = _job_id;

  UPDATE public.campaign_send_job_items
     SET next_attempt_at = _new_at
   WHERE job_id = _job_id
     AND status IN ('queued','retrying','paused');
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_send_job_schedule(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_send_job_recipients(_job_id uuid)
RETURNS TABLE (
  id uuid,
  recipient_email text,
  recipient_name text,
  status text,
  last_error_message text,
  attempt_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
BEGIN
  SELECT created_by INTO v_creator FROM public.campaign_send_jobs WHERE id = _job_id;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF v_creator <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  SELECT i.id, i.recipient_email, i.recipient_name, i.status,
         i.last_error_message, i.attempt_count
  FROM public.campaign_send_job_items i
  WHERE i.job_id = _job_id
  ORDER BY i.created_at ASC
  LIMIT 500;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_send_job_recipients(uuid) TO authenticated;

WITH ndr_rows AS (
  SELECT cc.id
  FROM public.campaign_communications cc
  WHERE cc.communication_type = 'Email'
    AND cc.sent_via = 'graph-sync'
    AND cc.delivery_status = 'received'
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
    )
)
UPDATE public.campaign_communications cc
   SET email_status = 'Bounced',
       delivery_status = 'failed',
       bounced_at = COALESCE(cc.bounced_at, cc.communication_date),
       bounce_type = COALESCE(cc.bounce_type, 'unknown'),
       bounce_reason = COALESCE(cc.bounce_reason, LEFT(COALESCE(cc.subject,''), 500))
  FROM ndr_rows
 WHERE cc.id = ndr_rows.id;

UPDATE public.campaign_communications parent
   SET email_status = 'Bounced',
       delivery_status = 'failed',
       bounced_at = COALESCE(parent.bounced_at, now())
  FROM public.campaign_communications ndr
 WHERE ndr.email_status = 'Bounced'
   AND ndr.sent_via = 'graph-sync'
   AND ndr.conversation_id IS NOT NULL
   AND parent.conversation_id = ndr.conversation_id
   AND parent.communication_type = 'Email'
   AND parent.sent_via IN ('azure','manual')
   AND parent.delivery_status = 'sent'
   AND parent.email_status <> 'Bounced';
