-- Currency rates table for USD-base converter (USD/EUR/INR)
CREATE TABLE IF NOT EXISTS public.currency_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base text NOT NULL DEFAULT 'USD',
  quote text NOT NULL,
  rate numeric(20,8) NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'exchangerate.host',
  UNIQUE (base, quote)
);

GRANT SELECT ON public.currency_rates TO authenticated;
GRANT ALL    ON public.currency_rates TO service_role;

ALTER TABLE public.currency_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read rates" ON public.currency_rates;
CREATE POLICY "Authenticated read rates"
  ON public.currency_rates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Service role manages rates" ON public.currency_rates;
CREATE POLICY "Service role manages rates"
  ON public.currency_rates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed identity & approximate values; refresh edge function will overwrite
INSERT INTO public.currency_rates(base, quote, rate) VALUES
  ('USD','USD',1),
  ('USD','EUR',0.92),
  ('USD','INR',83.0)
ON CONFLICT (base, quote) DO NOTHING;

-- Daily cron at 02:15 UTC -> refresh-currency-rates edge function
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-currency-rates-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-currency-rates-daily',
  '15 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://emcppynoiprlowuowgan.supabase.co/functions/v1/refresh-currency-rates',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);
