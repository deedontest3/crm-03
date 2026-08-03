-- 1) profiles_public view -> security invoker (respects caller's RLS)
ALTER VIEW public.profiles_public SET (security_invoker = true);

-- 2) Lock search_path on two helper functions that were missing it
CREATE OR REPLACE FUNCTION public.normalize_company_key(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(_name, '')), '[^a-z0-9]+', ' ', 'g'),
        '\m(limited|ltd|llc|inc|incorporated|corp|corporation|company|co|gmbh|ag|plc|sa|sarl|bv|nv|kg|oy|ab|spa|srl|pvt|pte|llp|uk|usa|us|de|fr|india)\M',
        '',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.company_keys_match(_left text, _right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN public.normalize_company_key(_left) = '' OR public.normalize_company_key(_right) = '' THEN false
    WHEN public.normalize_company_key(_left) = public.normalize_company_key(_right) THEN true
    WHEN length(public.normalize_company_key(_left)) >= 5
      AND public.normalize_company_key(_right) LIKE public.normalize_company_key(_left) || '%' THEN true
    WHEN length(public.normalize_company_key(_right)) >= 5
      AND public.normalize_company_key(_left) LIKE public.normalize_company_key(_right) || '%' THEN true
    ELSE false
  END;
$function$;