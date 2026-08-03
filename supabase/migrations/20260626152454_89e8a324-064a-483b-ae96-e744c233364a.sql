-- Stale-deal alerts: SLA config + stage_entered_at tracking

CREATE TABLE public.stage_sla_config (
  stage text PRIMARY KEY,
  days integer NOT NULL CHECK (days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stage_sla_config TO authenticated;
GRANT ALL ON public.stage_sla_config TO service_role;

ALTER TABLE public.stage_sla_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_sla read" ON public.stage_sla_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "stage_sla admin write" ON public.stage_sla_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.stage_sla_config(stage, days) VALUES
  ('Lead', 7),
  ('Discussions', 10),
  ('Qualified', 14),
  ('RFQ', 14),
  ('Offered', 14),
  ('Negotiation', 10),
  ('Verbal Approval', 7);

-- stage_entered_at on deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now();

UPDATE public.deals
SET stage_entered_at = COALESCE(modified_at, created_at, now());

CREATE OR REPLACE FUNCTION public.set_stage_entered_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stage_entered_at := now();
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_stage_entered_at ON public.deals;
CREATE TRIGGER trg_set_stage_entered_at
  BEFORE INSERT OR UPDATE OF stage ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.set_stage_entered_at();