CREATE OR REPLACE FUNCTION public.should_create_in_app_notification(
  _user_id uuid,
  _notification_type text,
  _module_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prefs public.notification_preferences%ROWTYPE;
  normalized_type text := coalesce(_notification_type, '');
  normalized_module text := coalesce(_module_type, '');
BEGIN
  SELECT * INTO prefs
  FROM public.notification_preferences
  WHERE user_id = _user_id;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  IF coalesce(prefs.in_app_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type IN ('action_item', 'task_reminder', 'meeting_reminder') THEN
    RETURN coalesce(prefs.task_reminders, true) IS TRUE;
  END IF;

  IF normalized_type IN ('deal_update', 'deal_stale')
     AND coalesce(prefs.deal_updates, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type = 'lead_assigned'
     AND (coalesce(prefs.lead_assigned, true) IS NOT TRUE OR coalesce(prefs.leads_notifications, true) IS NOT TRUE) THEN
    RETURN false;
  END IF;

  IF normalized_type = 'lead_update'
     AND coalesce(prefs.leads_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type = 'account_update'
     AND coalesce(prefs.accounts_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type = 'contact_update'
     AND coalesce(prefs.contacts_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type NOT IN ('deal_update', 'deal_stale', 'lead_assigned', 'lead_update', 'account_update', 'contact_update') THEN
    RETURN true;
  END IF;

  RETURN CASE normalized_module
    WHEN 'deals' THEN coalesce(prefs.deal_updates, true) IS TRUE
    WHEN 'leads' THEN coalesce(prefs.leads_notifications, true) IS TRUE
    WHEN 'accounts' THEN coalesce(prefs.accounts_notifications, true) IS TRUE
    WHEN 'contacts' THEN coalesce(prefs.contacts_notifications, true) IS TRUE
    ELSE true
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.should_create_in_app_notification(uuid, text, text) TO service_role;