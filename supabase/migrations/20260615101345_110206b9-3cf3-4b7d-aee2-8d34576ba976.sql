CREATE TABLE IF NOT EXISTS public.backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  upload_path text,
  request_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb,
  result jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.backup_jobs TO authenticated;
GRANT ALL ON public.backup_jobs TO service_role;

ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_backup_jobs_user_created_at ON public.backup_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_status_updated_at ON public.backup_jobs(status, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'backup_jobs'
      AND policyname = 'Users can view their own backup jobs'
  ) THEN
    CREATE POLICY "Users can view their own backup jobs"
      ON public.backup_jobs
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.is_user_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'backup_jobs'
      AND policyname = 'Service role can manage backup jobs'
  ) THEN
    CREATE POLICY "Service role can manage backup jobs"
      ON public.backup_jobs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_backup_jobs_updated_at ON public.backup_jobs;
CREATE TRIGGER update_backup_jobs_updated_at
  BEFORE UPDATE ON public.backup_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();