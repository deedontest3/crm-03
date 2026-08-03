-- RPC to pause all queued/in-flight send job items for a campaign
CREATE OR REPLACE FUNCTION public.pause_all_campaign_jobs(_campaign_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _items_paused integer := 0;
  _jobs_paused integer := 0;
BEGIN
  -- Permission: admin OR campaign manager
  IF NOT (public.is_user_admin() OR public.can_manage_campaign(_campaign_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Pause queued items (not yet attempted or in retry backoff)
  UPDATE public.campaign_send_job_items
  SET status = 'paused', updated_at = now()
  WHERE campaign_id = _campaign_id
    AND status IN ('queued', 'retry');
  GET DIAGNOSTICS _items_paused = ROW_COUNT;

  -- Pause parent jobs that are queued/running
  UPDATE public.campaign_send_jobs
  SET status = 'paused', updated_at = now()
  WHERE campaign_id = _campaign_id
    AND status IN ('queued', 'running', 'scheduled');
  GET DIAGNOSTICS _jobs_paused = ROW_COUNT;

  -- Audit event
  INSERT INTO public.campaign_events (campaign_id, actor_user_id, event_type, reason, metadata)
  VALUES (
    _campaign_id,
    auth.uid(),
    'bulk_pause',
    COALESCE(_reason, 'Operator paused all sends'),
    jsonb_build_object('items_paused', _items_paused, 'jobs_paused', _jobs_paused)
  );

  RETURN jsonb_build_object('items_paused', _items_paused, 'jobs_paused', _jobs_paused);
END;
$$;

REVOKE ALL ON FUNCTION public.pause_all_campaign_jobs(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_all_campaign_jobs(uuid, text) TO authenticated;