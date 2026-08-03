CREATE OR REPLACE FUNCTION public.normalize_company_key(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.company_keys_match(_left text, _right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.normalize_company_key(_left) = '' OR public.normalize_company_key(_right) = '' THEN false
    WHEN public.normalize_company_key(_left) = public.normalize_company_key(_right) THEN true
    WHEN length(public.normalize_company_key(_left)) >= 5
      AND public.normalize_company_key(_right) LIKE public.normalize_company_key(_left) || '%' THEN true
    WHEN length(public.normalize_company_key(_right)) >= 5
      AND public.normalize_company_key(_left) LIKE public.normalize_company_key(_right) || '%' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_account_linked_contacts(_account_ids uuid[])
RETURNS TABLE (
  account_id uuid,
  contact_id uuid,
  contact_name text,
  company_name text,
  contact_position text,
  email text,
  phone_no text,
  contact_account_id uuid,
  link_sources text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested_accounts AS (
    SELECT a.id, a.account_name
    FROM public.accounts a
    WHERE a.id = ANY(_account_ids)
      AND (
        public.is_user_admin()
        OR a.created_by = auth.uid()
        OR a.account_owner = auth.uid()
      )
  ),
  accessible_deals AS (
    SELECT d.*
    FROM public.deals d
    JOIN requested_accounts a ON a.id = d.account_id
  ),
  linked_pairs AS (
    SELECT c.account_id, c.id AS contact_id, 'direct_account'::text AS source
    FROM public.contacts c
    JOIN requested_accounts a ON a.id = c.account_id

    UNION ALL

    SELECT d.account_id, ds.contact_id, 'deal_stakeholder'::text AS source
    FROM accessible_deals d
    JOIN public.deal_stakeholders ds ON ds.deal_id = d.id
    WHERE d.account_id IS NOT NULL

    UNION ALL

    SELECT d.account_id, v.contact_id, v.source
    FROM accessible_deals d
    CROSS JOIN LATERAL (
      VALUES
        (d.budget_owner_contact_id, 'budget_owner'::text),
        (d.champion_contact_id, 'champion'::text),
        (d.influencer_contact_id, 'influencer'::text),
        (d.objector_contact_id, 'objector'::text)
    ) AS v(contact_id, source)
    WHERE d.account_id IS NOT NULL AND v.contact_id IS NOT NULL

    UNION ALL

    SELECT d.account_id, cc.contact_id, 'source_campaign_contact'::text AS source
    FROM accessible_deals d
    JOIN public.campaign_contacts cc ON cc.id = d.source_campaign_contact_id
    WHERE d.account_id IS NOT NULL

    UNION ALL

    SELECT cc.account_id, cc.contact_id, 'campaign_account'::text AS source
    FROM public.campaign_contacts cc
    JOIN requested_accounts a ON a.id = cc.account_id
    WHERE cc.account_id IS NOT NULL

    UNION ALL

    SELECT a.id AS account_id, c.id AS contact_id, 'company_match'::text AS source
    FROM requested_accounts a
    JOIN public.contacts c ON public.company_keys_match(c.company_name, a.account_name)

    UNION ALL

    SELECT d.account_id, c.id AS contact_id, 'deal_lead_name'::text AS source
    FROM accessible_deals d
    JOIN requested_accounts a ON a.id = d.account_id
    JOIN public.contacts c
      ON lower(trim(c.contact_name)) = lower(trim(d.lead_name))
      AND (
        c.account_id = a.id
        OR public.company_keys_match(c.company_name, a.account_name)
        OR c.company_name IS NULL
        OR trim(c.company_name) = ''
      )
    WHERE d.account_id IS NOT NULL AND d.lead_name IS NOT NULL AND trim(d.lead_name) <> ''
  ),
  grouped AS (
    SELECT lp.account_id, lp.contact_id, array_agg(DISTINCT lp.source ORDER BY lp.source) AS link_sources
    FROM linked_pairs lp
    WHERE lp.account_id IS NOT NULL AND lp.contact_id IS NOT NULL
    GROUP BY lp.account_id, lp.contact_id
  )
  SELECT
    g.account_id,
    c.id AS contact_id,
    c.contact_name,
    c.company_name,
    c.position AS contact_position,
    c.email,
    c.phone_no,
    c.account_id AS contact_account_id,
    g.link_sources
  FROM grouped g
  JOIN public.contacts c ON c.id = g.contact_id
  ORDER BY c.contact_name;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_company_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_keys_match(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_company_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.company_keys_match(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO service_role;

UPDATE public.contacts c
SET account_id = a.id,
    modified_time = now()
FROM public.accounts a
WHERE c.account_id IS NULL
  AND public.company_keys_match(c.company_name, a.account_name);

UPDATE public.contacts c
SET account_id = d.account_id,
    modified_time = now()
FROM public.deal_stakeholders ds
JOIN public.deals d ON d.id = ds.deal_id
WHERE c.id = ds.contact_id
  AND c.account_id IS NULL
  AND d.account_id IS NOT NULL;

UPDATE public.contacts c
SET account_id = d.account_id,
    modified_time = now()
FROM public.deals d
WHERE c.account_id IS NULL
  AND d.account_id IS NOT NULL
  AND c.id IN (d.budget_owner_contact_id, d.champion_contact_id, d.influencer_contact_id, d.objector_contact_id);

UPDATE public.contacts c
SET account_id = cc.account_id,
    modified_time = now()
FROM public.campaign_contacts cc
WHERE c.id = cc.contact_id
  AND c.account_id IS NULL
  AND cc.account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_contact_account_from_deal_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_account_id uuid;
BEGIN
  SELECT d.account_id INTO linked_account_id
  FROM public.deals d
  WHERE d.id = NEW.deal_id;

  IF linked_account_id IS NOT NULL THEN
    UPDATE public.contacts
    SET account_id = COALESCE(account_id, linked_account_id),
        modified_time = now()
    WHERE id = NEW.contact_id
      AND account_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contact_account_from_deal_stakeholders ON public.deal_stakeholders;
CREATE TRIGGER trg_sync_contact_account_from_deal_stakeholders
AFTER INSERT OR UPDATE OF deal_id, contact_id ON public.deal_stakeholders
FOR EACH ROW
EXECUTE FUNCTION public.sync_contact_account_from_deal_links();