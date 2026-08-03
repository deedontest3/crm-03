-- Remove obsolete deal-date validation that blocked planned Project Start Dates
-- unless Handoff Status was set. Handoff Status is optional and Project Start
-- Date can be future-dated for RFQ / Verbal Approval planning.
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