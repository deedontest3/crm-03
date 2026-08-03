REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.should_create_in_app_notification(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.should_create_in_app_notification(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.suppress_notification_by_preferences() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suppress_notification_by_preferences() FROM anon;
REVOKE ALL ON FUNCTION public.suppress_notification_by_preferences() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_notification_by_preferences() TO service_role;