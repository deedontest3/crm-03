-- Pin fixed cross-rate: 1 EUR = 105 INR
-- With USD->EUR = 0.8785, USD->INR = 0.8785 * 105 = 92.2425
INSERT INTO public.currency_rates (base, quote, rate, fetched_at, source)
VALUES ('USD', 'INR', 92.2425, now(), 'fixed-rate-2026')
ON CONFLICT (base, quote)
DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source;