-- Backfill contacts.account_id from company_name match where missing
UPDATE public.contacts c
SET account_id = a.id
FROM public.accounts a
WHERE c.account_id IS NULL
  AND c.company_name IS NOT NULL
  AND lower(btrim(c.company_name)) = lower(btrim(a.account_name));

-- Backfill stakeholder contacts that have no account_id from their deal's account
UPDATE public.contacts c
SET account_id = d.account_id
FROM public.deal_stakeholders ds
JOIN public.deals d ON d.id = ds.deal_id
WHERE c.id = ds.contact_id
  AND c.account_id IS NULL
  AND d.account_id IS NOT NULL;

-- Trigger to keep contact.account_id populated when a stakeholder is added
CREATE OR REPLACE FUNCTION public.deal_stakeholder_backfill_contact_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.contacts c
  SET account_id = d.account_id
  FROM public.deals d
  WHERE d.id = NEW.deal_id
    AND c.id = NEW.contact_id
    AND c.account_id IS NULL
    AND d.account_id IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_stakeholder_backfill_contact_account ON public.deal_stakeholders;
CREATE TRIGGER trg_deal_stakeholder_backfill_contact_account
AFTER INSERT ON public.deal_stakeholders
FOR EACH ROW
EXECUTE FUNCTION public.deal_stakeholder_backfill_contact_account();