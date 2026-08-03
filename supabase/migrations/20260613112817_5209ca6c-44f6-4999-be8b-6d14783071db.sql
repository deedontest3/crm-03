-- Always overwrite probability from stage on insert and update
CREATE OR REPLACE FUNCTION public.deals_set_probability_from_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.probability := CASE NEW.stage
    WHEN 'Lead' THEN 0
    WHEN 'Discussions' THEN 10
    WHEN 'Qualified' THEN 20
    WHEN 'RFQ' THEN 30
    WHEN 'Offered' THEN 50
    WHEN 'Negotiation' THEN 70
    WHEN 'Verbal Approval' THEN 90
    WHEN 'Won' THEN 100
    WHEN 'Lost' THEN 0
    WHEN 'Hold' THEN 0
    WHEN 'Dropped' THEN 0
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_set_probability_trg ON public.deals;
CREATE TRIGGER deals_set_probability_trg
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.deals_set_probability_from_stage();