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

  IF normalized_type IN ('action_item', 'task_reminder', 'meeting_reminder')
     AND coalesce(prefs.task_reminders, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF (normalized_type IN ('deal_update', 'deal_stale') OR normalized_module = 'deals')
     AND coalesce(prefs.deal_updates, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF normalized_type = 'lead_assigned'
     AND (coalesce(prefs.lead_assigned, true) IS NOT TRUE OR coalesce(prefs.leads_notifications, true) IS NOT TRUE) THEN
    RETURN false;
  END IF;

  IF (normalized_type = 'lead_update' OR normalized_module = 'leads')
     AND coalesce(prefs.leads_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF (normalized_type = 'account_update' OR normalized_module = 'accounts')
     AND coalesce(prefs.accounts_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF (normalized_type = 'contact_update' OR normalized_module = 'contacts')
     AND coalesce(prefs.contacts_notifications, true) IS NOT TRUE THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_notification_by_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.should_create_in_app_notification(NEW.user_id, NEW.notification_type, NEW.module_type) THEN
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS suppress_notifications_by_preferences ON public.notifications;
CREATE TRIGGER suppress_notifications_by_preferences
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.suppress_notification_by_preferences();