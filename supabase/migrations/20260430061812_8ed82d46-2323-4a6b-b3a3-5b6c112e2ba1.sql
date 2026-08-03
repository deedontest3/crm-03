-- 1) Restrict SELECT on campaign_settings to admins only.
DROP POLICY IF EXISTS "Authenticated users can view campaign settings" ON public.campaign_settings;
DROP POLICY IF EXISTS "All authenticated users can view campaign settings" ON public.campaign_settings;
DROP POLICY IF EXISTS "campaign_settings_select_authenticated" ON public.campaign_settings;

CREATE POLICY "campaign_settings_select_admin"
ON public.campaign_settings
FOR SELECT
TO authenticated
USING (public.is_user_admin());

-- 2) Security-definer accessor so non-admin clients can read whitelisted setting values
--    (e.g. the bulk-send threshold consumed by EmailComposeModal) without seeing the rest.
CREATE OR REPLACE FUNCTION public.get_campaign_setting(_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT setting_value
  FROM public.campaign_settings
  WHERE setting_key = _key
    AND _key IN (
      'enqueue_threshold',
      'approval_required_threshold',
      'default_business_hours_start',
      'default_business_hours_end',
      'default_timezone'
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_setting(text) TO authenticated;

-- 3) Tighten campaign_send_log INSERT: a regular user can only insert a row attributed
--    to themselves on a campaign they manage. Service-role bypasses RLS so the runner
--    is unaffected.
DROP POLICY IF EXISTS "Users insert their own send log" ON public.campaign_send_log;
DROP POLICY IF EXISTS "campaign_send_log_insert_self" ON public.campaign_send_log;

CREATE POLICY "campaign_send_log_insert_self_managed"
ON public.campaign_send_log
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_user_id
  AND (campaign_id IS NULL OR public.can_manage_campaign(campaign_id))
);
