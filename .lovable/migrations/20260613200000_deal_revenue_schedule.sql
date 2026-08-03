-- ============================================================
-- Multi-Year Quarterly Revenue Schedule for Deals
--
-- Apply this via Lovable's "Run SQL" / migration tool — the agent
-- cannot write directly into supabase/migrations/. After you run it,
-- the new table, RLS, trigger, and backfill are live.
-- ============================================================

-- 1) Table
CREATE TABLE IF NOT EXISTS public.deal_revenue_schedule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  year        int  NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  quarter     int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  revenue     numeric(14,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, year, quarter)
);

CREATE INDEX IF NOT EXISTS deal_revenue_schedule_deal_id_idx
  ON public.deal_revenue_schedule(deal_id);
CREATE INDEX IF NOT EXISTS deal_revenue_schedule_year_quarter_idx
  ON public.deal_revenue_schedule(year, quarter);
CREATE INDEX IF NOT EXISTS deal_revenue_schedule_year_idx
  ON public.deal_revenue_schedule(year);

-- 2) Grants (PostgREST)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_revenue_schedule TO authenticated;
GRANT ALL ON public.deal_revenue_schedule TO service_role;

-- 3) RLS — mirror parent deals (EXISTS honours deals' own RLS)
ALTER TABLE public.deal_revenue_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drs_select" ON public.deal_revenue_schedule;
CREATE POLICY "drs_select"
ON public.deal_revenue_schedule
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_revenue_schedule.deal_id));

DROP POLICY IF EXISTS "drs_insert" ON public.deal_revenue_schedule;
CREATE POLICY "drs_insert"
ON public.deal_revenue_schedule
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_revenue_schedule.deal_id));

DROP POLICY IF EXISTS "drs_update" ON public.deal_revenue_schedule;
CREATE POLICY "drs_update"
ON public.deal_revenue_schedule
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_revenue_schedule.deal_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_revenue_schedule.deal_id));

DROP POLICY IF EXISTS "drs_delete" ON public.deal_revenue_schedule;
CREATE POLICY "drs_delete"
ON public.deal_revenue_schedule
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_revenue_schedule.deal_id));

-- 4) updated_at trigger (reuse existing helper)
DROP TRIGGER IF EXISTS set_drs_updated_at ON public.deal_revenue_schedule;
CREATE TRIGGER set_drs_updated_at
BEFORE UPDATE ON public.deal_revenue_schedule
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Keep deals.total_revenue in sync with sum of schedule rows
CREATE OR REPLACE FUNCTION public.sync_deal_total_revenue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_deal uuid;
BEGIN
  target_deal := COALESCE(NEW.deal_id, OLD.deal_id);
  UPDATE public.deals
     SET total_revenue = COALESCE((
       SELECT SUM(revenue) FROM public.deal_revenue_schedule WHERE deal_id = target_deal
     ), 0)
   WHERE id = target_deal;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_deal_total_revenue_trg ON public.deal_revenue_schedule;
CREATE TRIGGER sync_deal_total_revenue_trg
AFTER INSERT OR UPDATE OR DELETE ON public.deal_revenue_schedule
FOR EACH ROW EXECUTE FUNCTION public.sync_deal_total_revenue();

-- 6) Idempotent backfill from legacy columns
INSERT INTO public.deal_revenue_schedule (deal_id, year, quarter, revenue)
SELECT d.id,
       EXTRACT(YEAR FROM COALESCE(d.signed_contract_date, d.expected_closing_date, now()))::int AS year,
       q.quarter,
       q.amount
FROM public.deals d
CROSS JOIN LATERAL (VALUES
  (1, COALESCE(d.quarterly_revenue_q1, 0)),
  (2, COALESCE(d.quarterly_revenue_q2, 0)),
  (3, COALESCE(d.quarterly_revenue_q3, 0)),
  (4, COALESCE(d.quarterly_revenue_q4, 0))
) AS q(quarter, amount)
WHERE q.amount > 0
ON CONFLICT (deal_id, year, quarter) DO NOTHING;
