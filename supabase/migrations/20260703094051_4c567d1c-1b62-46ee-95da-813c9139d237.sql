-- Follow-up idempotency: unique step_id per (campaign, contact) so concurrent
-- follow-up runner passes can race the INSERT and lose cleanly.
ALTER TABLE public.campaign_send_log
  ADD COLUMN IF NOT EXISTS step_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_send_log_step_dedup
  ON public.campaign_send_log (campaign_id, contact_id, step_id)
  WHERE step_id IS NOT NULL;

-- Restore concurrency guard: single-row advisory lock table for both
-- restore-backup and restore-advanced-backup.
CREATE TABLE IF NOT EXISTS public.backup_restore_locks (
  id text PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquired_by uuid,
  source text NOT NULL
);

GRANT SELECT ON public.backup_restore_locks TO authenticated;
GRANT ALL ON public.backup_restore_locks TO service_role;

ALTER TABLE public.backup_restore_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view restore locks"
  ON public.backup_restore_locks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));