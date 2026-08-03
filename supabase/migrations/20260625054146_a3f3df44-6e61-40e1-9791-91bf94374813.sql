
-- Add unique constraint for upsert on (user_id, session_token)
ALTER TABLE public.user_sessions
  ADD CONSTRAINT user_sessions_user_session_unique UNIQUE (user_id, session_token);

-- Deactivate sessions inactive for more than 30 days (cleans up old test data too)
UPDATE public.user_sessions
SET is_active = false
WHERE is_active = true
  AND last_active_at < now() - interval '30 days';
