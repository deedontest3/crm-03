CREATE UNIQUE INDEX IF NOT EXISTS campaign_send_log_followup_uniq
  ON public.campaign_send_log (campaign_id, contact_id, step_id)
  WHERE step_id IS NOT NULL;