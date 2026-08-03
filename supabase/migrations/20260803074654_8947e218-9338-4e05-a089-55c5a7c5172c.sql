CREATE OR REPLACE FUNCTION public.validate_deal_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  competitor_stages text[] := ARRAY['Negotiation','Verbal Approval','Won'];
BEGIN
  -- Date rules are advisory in the UI only; the database no longer blocks
  -- past or future dates or out-of-order dates.
  IF NEW.stage = ANY(competitor_stages)
     AND COALESCE(NEW.competition, '') = 'Yes'
     AND (NEW.competitors IS NULL OR btrim(NEW.competitors) = '') THEN
    RAISE EXCEPTION 'Competitors are required when competition is Yes';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_deal_dates_trigger ON public.deals;
DROP TRIGGER IF EXISTS validate_deal_date_rules_trigger ON public.deals;
DROP TRIGGER IF EXISTS validate_deal_business_rules_trigger ON public.deals;

CREATE TRIGGER validate_deal_business_rules_trigger
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_deal_business_rules();