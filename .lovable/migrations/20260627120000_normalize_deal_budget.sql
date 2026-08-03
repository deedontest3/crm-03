-- Normalize legacy `deals.budget` text values into pure numeric strings
-- and backfill `currency_type` from any symbol/code found in the old text.
-- No columns are added or dropped. Safe to re-run (idempotent).

-- 1) Backfill currency_type from symbol/code embedded in legacy budget text,
--    only when currency_type is currently NULL.
UPDATE public.deals
SET currency_type = CASE
  WHEN budget ~* '(usd|\$)'        THEN 'USD'
  WHEN budget ~* '(eur|€)'         THEN 'EUR'
  WHEN budget ~* '(inr|₹|rs\.?)'   THEN 'INR'
  ELSE currency_type
END
WHERE currency_type IS NULL
  AND budget IS NOT NULL
  AND budget ~* '(usd|eur|inr|\$|€|₹|rs\.?)';

-- 2) Strip symbols/commas/spaces from budget text → pure numeric string.
--    Only rewrite rows that aren't already a clean number; leave free-text
--    values (e.g. "TBD") untouched so no data is lost.
UPDATE public.deals
SET budget = NULLIF(regexp_replace(budget, '[^0-9.\-]', '', 'g'), '')
WHERE budget IS NOT NULL
  AND budget !~ '^-?[0-9]+(\.[0-9]+)?$'
  AND regexp_replace(budget, '[^0-9.\-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$';

-- 3) Report how many rows still hold un-parseable budget text.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.deals
   WHERE budget IS NOT NULL
     AND btrim(budget) <> ''
     AND budget !~ '^-?[0-9]+(\.[0-9]+)?$';
  RAISE NOTICE 'normalize_deal_budget: % row(s) still contain non-numeric budget text', n;
END $$;
