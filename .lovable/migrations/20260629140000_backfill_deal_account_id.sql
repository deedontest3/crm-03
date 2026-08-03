-- Backfill deals.account_id from customer_name (unambiguous match) and
-- fall back to the lead contact's account when still empty.

UPDATE public.deals d
SET account_id = a.id,
    modified_at = now()
FROM public.accounts a
WHERE d.account_id IS NULL
  AND d.customer_name IS NOT NULL
  AND lower(btrim(a.account_name)) = lower(btrim(d.customer_name))
  AND (
    SELECT count(*) FROM public.accounts a2
    WHERE lower(btrim(a2.account_name)) = lower(btrim(d.customer_name))
  ) = 1;

UPDATE public.deals d
SET account_id = c.account_id,
    modified_at = now()
FROM public.contacts c
WHERE d.account_id IS NULL
  AND c.account_id IS NOT NULL
  AND d.lead_name IS NOT NULL
  AND lower(btrim(c.contact_name)) = lower(btrim(d.lead_name));
