CREATE OR REPLACE FUNCTION public.validate_deal_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  competitor_stages text[] := ARRAY['Negotiation','Verbal Approval','Won'];
BEGIN
  -- Archive / restore is not a business edit: skip validation when the archived
  -- state changes and the stage is untouched.
  IF TG_OP = 'UPDATE'
     AND NEW.archived_at IS DISTINCT FROM OLD.archived_at
     AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;

  IF NEW.stage = ANY(competitor_stages)
     AND COALESCE(NEW.competition, '') = 'Yes'
     AND (NEW.competitors IS NULL OR btrim(NEW.competitors) = '') THEN
    RAISE EXCEPTION 'Competitors are required when competition is Yes';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_won_stage_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.stage = 'Won'
     AND NEW.stage IS DISTINCT FROM OLD.stage THEN

    -- Archive / restore never changes stage, so it can never reach here; keep
    -- the guard explicit anyway.
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RETURN NEW;
    END IF;

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
$function$;