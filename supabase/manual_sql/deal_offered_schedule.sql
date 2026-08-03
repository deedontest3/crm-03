-- Run this once on the Supabase project that your app talks to
-- (the project that already contains your `deals` and `deal_revenue_schedule` tables).

CREATE TABLE IF NOT EXISTS public.deal_offered_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  year int NOT NULL,
  quarter int NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  revenue numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, year, quarter)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_offered_schedule TO authenticated;
GRANT ALL ON public.deal_offered_schedule TO service_role;

ALTER TABLE public.deal_offered_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read offered schedule" ON public.deal_offered_schedule;
CREATE POLICY "Authenticated can read offered schedule"
  ON public.deal_offered_schedule FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert offered schedule" ON public.deal_offered_schedule;
CREATE POLICY "Authenticated can insert offered schedule"
  ON public.deal_offered_schedule FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update offered schedule" ON public.deal_offered_schedule;
CREATE POLICY "Authenticated can update offered schedule"
  ON public.deal_offered_schedule FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete offered schedule" ON public.deal_offered_schedule;
CREATE POLICY "Authenticated can delete offered schedule"
  ON public.deal_offered_schedule FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_deal_offered_schedule_updated_at ON public.deal_offered_schedule;
CREATE TRIGGER update_deal_offered_schedule_updated_at
  BEFORE UPDATE ON public.deal_offered_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_deal_offered_schedule_deal ON public.deal_offered_schedule(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_offered_schedule_yq ON public.deal_offered_schedule(year, quarter);
