
ALTER TABLE public.cleanup_dismissals DROP CONSTRAINT IF EXISTS cleanup_dismissals_user_id_finding_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS cleanup_dismissals_unique_scope
  ON public.cleanup_dismissals (module, rule, finding_id, user_id);
