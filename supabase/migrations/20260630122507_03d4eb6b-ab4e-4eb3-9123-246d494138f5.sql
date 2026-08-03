ALTER TABLE public.yearly_revenue_targets
  ADD COLUMN IF NOT EXISTS q1_target numeric,
  ADD COLUMN IF NOT EXISTS q2_target numeric,
  ADD COLUMN IF NOT EXISTS q3_target numeric,
  ADD COLUMN IF NOT EXISTS q4_target numeric;