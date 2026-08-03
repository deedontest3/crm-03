
CREATE TABLE public.yearly_revenue_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  business_unit TEXT NOT NULL CHECK (business_unit IN ('EBU','RT','MBU')),
  total_target NUMERIC NOT NULL DEFAULT 0,
  q1_target NUMERIC,
  q2_target NUMERIC,
  q3_target NUMERIC,
  q4_target NUMERIC,
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, business_unit)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.yearly_revenue_targets TO authenticated;
GRANT ALL ON public.yearly_revenue_targets TO service_role;

ALTER TABLE public.yearly_revenue_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read revenue targets"
  ON public.yearly_revenue_targets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert revenue targets"
  ON public.yearly_revenue_targets FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update revenue targets"
  ON public.yearly_revenue_targets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete revenue targets"
  ON public.yearly_revenue_targets FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_yearly_revenue_targets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_yearly_revenue_targets_updated_at
  BEFORE UPDATE ON public.yearly_revenue_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_yearly_revenue_targets_updated_at();
