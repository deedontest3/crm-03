-- 1. Update stage check constraint to allow new stages (existing rows unaffected)
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_stage_check
  CHECK (stage = ANY (ARRAY[
    'Lead'::text, 'Discussions'::text, 'Qualified'::text, 'RFQ'::text,
    'Offered'::text, 'Negotiation'::text, 'Verbal Approval'::text,
    'Won'::text, 'Lost'::text, 'Hold'::text, 'Dropped'::text
  ]));

-- 2. Add new columns: bu (multiselect), ai (Yes/No), strategic (Yes/No)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS bu text[],
  ADD COLUMN IF NOT EXISTS ai text,
  ADD COLUMN IF NOT EXISTS strategic text;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_ai_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_ai_check
  CHECK (ai IS NULL OR ai = ANY (ARRAY['Yes'::text, 'No'::text]));

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_strategic_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_strategic_check
  CHECK (strategic IS NULL OR strategic = ANY (ARRAY['Yes'::text, 'No'::text]));

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_bu_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_bu_check
  CHECK (
    bu IS NULL OR (
      array_length(bu, 1) IS NULL OR
      bu <@ ARRAY['EBU'::text, 'RT'::text, 'MBU'::text]
    )
  );

-- 3. Auto-set probability from stage on insert / when stage changes
CREATE OR REPLACE FUNCTION public.deals_set_probability_from_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prob integer;
BEGIN
  v_prob := CASE NEW.stage
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
    ELSE NEW.probability
  END;

  IF TG_OP = 'INSERT' THEN
    NEW.probability := v_prob;
  ELSIF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.probability := v_prob;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_set_probability_trg ON public.deals;
CREATE TRIGGER deals_set_probability_trg
BEFORE INSERT OR UPDATE OF stage ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.deals_set_probability_from_stage();