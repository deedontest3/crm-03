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
      'duplicate_send_window_days',
      'default_business_hours_start',
      'default_business_hours_end',
      'default_timezone'
    )
  LIMIT 1;
$$;
