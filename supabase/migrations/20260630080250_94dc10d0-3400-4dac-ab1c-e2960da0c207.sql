ALTER TABLE public.deals
  ALTER COLUMN budget TYPE numeric USING NULLIF(btrim(budget), '')::numeric;