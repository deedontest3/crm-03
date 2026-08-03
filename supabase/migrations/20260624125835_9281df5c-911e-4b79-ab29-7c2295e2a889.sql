CREATE TABLE public.deal_offered_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  revenue numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, year, quarter)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_offered_schedule TO authenticated;
GRANT ALL ON public.deal_offered_schedule TO service_role;

ALTER TABLE public.deal_offered_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY dos_select ON public.deal_offered_schedule FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_offered_schedule.deal_id));
CREATE POLICY dos_insert ON public.deal_offered_schedule FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_offered_schedule.deal_id));
CREATE POLICY dos_update ON public.deal_offered_schedule FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_offered_schedule.deal_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_offered_schedule.deal_id));
CREATE POLICY dos_delete ON public.deal_offered_schedule FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_offered_schedule.deal_id));

CREATE INDEX deal_offered_schedule_deal_id_idx ON public.deal_offered_schedule(deal_id);

CREATE TRIGGER update_deal_offered_schedule_updated_at
  BEFORE UPDATE ON public.deal_offered_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();