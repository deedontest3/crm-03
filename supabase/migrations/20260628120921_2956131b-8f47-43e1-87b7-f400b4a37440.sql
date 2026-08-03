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

    SELECT a.id AS account_id, c.id AS contact_id, 'account_company_match'::text AS source
    FROM requested_accounts a
    JOIN public.contacts c ON public.company_keys_match(c.company_name, a.account_name)

    UNION ALL

    SELECT d.account_id, c.id AS contact_id, 'deal_customer_company_match'::text AS source
    FROM accessible_deals d
    JOIN public.contacts c ON public.company_keys_match(c.company_name, d.customer_name)
    WHERE d.account_id IS NOT NULL
      AND d.customer_name IS NOT NULL
      AND trim(d.customer_name) <> ''
      AND lower(trim(d.customer_name)) NOT IN ('-', 'na', 'n/a')

    UNION ALL

    SELECT d.account_id, c.id AS contact_id, 'deal_lead_name'::text AS source
    FROM accessible_deals d
    JOIN public.contacts c ON lower(trim(c.contact_name)) = lower(trim(d.lead_name))
    WHERE d.account_id IS NOT NULL
      AND d.lead_name IS NOT NULL
      AND trim(d.lead_name) <> ''
      AND lower(trim(d.lead_name)) NOT IN ('-', 'na', 'n/a')
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

GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO service_role;

UPDATE public.contacts c
SET account_id = d.account_id,
    modified_time = now()
FROM public.deals d
WHERE d.account_id IS NOT NULL
  AND c.account_id IS NULL
  AND d.lead_name IS NOT NULL
  AND trim(d.lead_name) <> ''
  AND lower(trim(d.lead_name)) NOT IN ('-', 'na', 'n/a')
  AND lower(trim(c.contact_name)) = lower(trim(d.lead_name));