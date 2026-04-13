-- 1. Backfill notification_preferences for users missing rows
INSERT INTO notification_preferences (user_id, task_reminders, email_notifications, daily_reminder_time)
SELECT id, true, true, '07:00'
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM notification_preferences)
ON CONFLICT (user_id) DO NOTHING;

-- 2. Create trigger to auto-create notification_preferences on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id, task_reminders, email_notifications, daily_reminder_time)
  VALUES (NEW.id, true, true, '07:00')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_notification_prefs
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_notification_preferences();

-- 3. Add admin SELECT policy on email_history so admins see all emails
CREATE POLICY "Admins can view all emails"
ON email_history FOR SELECT TO authenticated
USING (is_current_user_admin());