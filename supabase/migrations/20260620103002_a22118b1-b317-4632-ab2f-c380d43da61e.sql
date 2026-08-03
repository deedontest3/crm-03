
-- ============================================================
-- forecast_settings: single-row key/value config for the forecast
-- Admin gating is enforced in the Settings UI (no has_role helper in this project)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forecast_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.forecast_settings TO authenticated;
GRANT ALL ON public.forecast_settings TO service_role;

ALTER TABLE public.forecast_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forecast_settings_select_authenticated" ON public.forecast_settings;
CREATE POLICY "forecast_settings_select_authenticated"
  ON public.forecast_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "forecast_settings_write_authenticated" ON public.forecast_settings;
CREATE POLICY "forecast_settings_write_authenticated"
  ON public.forecast_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO public.forecast_settings (key, value)
VALUES ('global', '{"include_hold": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- stage_probabilities: editable per-stage default probabilities
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stage_probabilities (
  stage text PRIMARY KEY,
  probability integer NOT NULL CHECK (probability >= 0 AND probability <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.stage_probabilities TO authenticated;
GRANT ALL ON public.stage_probabilities TO service_role;

ALTER TABLE public.stage_probabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stage_probabilities_select_authenticated" ON public.stage_probabilities;
CREATE POLICY "stage_probabilities_select_authenticated"
  ON public.stage_probabilities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "stage_probabilities_write_authenticated" ON public.stage_probabilities;
CREATE POLICY "stage_probabilities_write_authenticated"
  ON public.stage_probabilities FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO public.stage_probabilities (stage, probability) VALUES
  ('Lead', 0),
  ('Discussions', 10),
  ('Qualified', 20),
  ('RFQ', 30),
  ('Offered', 50),
  ('Negotiation', 70),
  ('Verbal Approval', 90)
ON CONFLICT (stage) DO NOTHING;
