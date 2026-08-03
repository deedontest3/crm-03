CREATE OR REPLACE FUNCTION public.enforce_won_stage_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.stage = 'Won'
     AND NEW.stage IS DISTINCT FROM OLD.stage THEN

    is_admin := (
      auth.uid() IS NOT NULL AND (
        public.has_role(auth.uid(), 'admin'::user_role)
        OR public.has_role(auth.uid(), 'super_admin'::user_role)
      )
    );

    IF NOT is_admin THEN
      RAISE EXCEPTION 'Won deals are closed and cannot be moved to another stage. Contact an admin to reopen.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.stage <> 'Verbal Approval' THEN
      RAISE EXCEPTION 'A Won deal can only be reopened to "Verbal Approval" (attempted move to %).', NEW.stage
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_won_stage_lock_trigger ON public.deals;
CREATE TRIGGER enforce_won_stage_lock_trigger
BEFORE UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_won_stage_lock();