-- Relax validate_deal_dates trigger
-- Apply via Supabase SQL editor or migration runner.
CREATE OR REPLACE FUNCTION public.validate_deal_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.signed_contract_date IS NOT NULL AND NEW.signed_contract_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Signed contract date cannot be in the future';
  END IF;
  RETURN NEW;
END;
$function$;
