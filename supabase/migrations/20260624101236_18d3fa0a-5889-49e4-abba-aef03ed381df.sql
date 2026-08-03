
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS opportunity_summary text,
  ADD COLUMN IF NOT EXISTS poc text,
  ADD COLUMN IF NOT EXISTS opportunity_description text,
  ADD COLUMN IF NOT EXISTS customer_objection text,
  ADD COLUMN IF NOT EXISTS competition text,
  ADD COLUMN IF NOT EXISTS competitors text,
  ADD COLUMN IF NOT EXISTS final_tcv numeric,
  ADD COLUMN IF NOT EXISTS revise_date date;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_competition_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_competition_check CHECK (competition IS NULL OR competition IN ('Yes','No'));

ALTER TABLE public.deals
  DROP COLUMN IF EXISTS negotiation_type,
  DROP COLUMN IF EXISTS biggest_objection,
  DROP COLUMN IF EXISTS competitor_involved,
  DROP COLUMN IF EXISTS competitor_name,
  DROP COLUMN IF EXISTS discount_approval_status,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS verbal_approval_status,
  DROP COLUMN IF EXISTS approved_by_contact_id,
  DROP COLUMN IF EXISTS contract_status,
  DROP COLUMN IF EXISTS forecast_category,
  DROP COLUMN IF EXISTS hold_start_date,
  DROP COLUMN IF EXISTS expected_resume_date,
  DROP COLUMN IF EXISTS likelihood_to_resume,
  DROP COLUMN IF EXISTS reactivation_trigger,
  DROP COLUMN IF EXISTS hold_notes,
  DROP COLUMN IF EXISTS need_improvement;
