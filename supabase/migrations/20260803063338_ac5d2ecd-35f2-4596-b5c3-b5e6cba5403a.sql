CREATE OR REPLACE FUNCTION public.get_account_linked_contacts(_account_ids uuid[])
RETURNS TABLE(account_id uuid, contact_id uuid, contact_name text, company_name text, contact_position text, email text, phone_no text, contact_account_id uuid, link_sources text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH requested_accounts AS (
    SELECT a.id, a.account_name, public.normalize_company_key(a.account_name) AS akey
    FROM public.accounts a
    WHERE a.id = ANY(_account_ids)
      AND (
        public.is_user_admin()
        OR a.created_by = auth.uid()
        OR a.account_owner = auth.uid()
      )
  ),
  accessible_deals AS (
    SELECT d.id, d.account_id, d.customer_name, d.lead_name,
           d.budget_owner_contact_id, d.champion_contact_id,
           d.influencer_contact_id, d.objector_contact_id,
           d.source_campaign_contact_id,
           public.normalize_company_key(d.customer_name) AS dkey
    FROM public.deals d
    JOIN requested_accounts a ON a.id = d.account_id
  ),
  -- All company keys we need to match against, from accounts and from deals.
  match_keys AS (
    SELECT id AS account_id, akey AS key FROM requested_accounts WHERE akey <> ''
    UNION
    SELECT account_id, dkey FROM accessible_deals
    WHERE account_id IS NOT NULL AND dkey <> ''
      AND lower(btrim(customer_name)) NOT IN ('-', 'na', 'n/a')
  ),
  -- Prefixes (>= 5 chars) of each key, used for the "contact company is a
  -- shorter form of the account/deal company" direction via an index lookup.
  key_prefixes AS (
    SELECT mk.account_id, left(mk.key, n) AS pkey
    FROM match_keys mk
    CROSS JOIN LATERAL generate_series(5, greatest(length(mk.key), 5)) AS n
    WHERE length(mk.key) >= 5
  ),
  company_matches AS (
    -- exact key equality (uses idx_contacts_company_key)
    SELECT mk.account_id, c.id AS contact_id
    FROM match_keys mk
    JOIN public.contacts c
      ON public.normalize_company_key(c.company_name) = mk.key

    UNION

    -- contact key starts with the account/deal key (range scan on
    -- idx_contacts_company_key_pattern)
    SELECT mk.account_id, c.id
    FROM match_keys mk
    JOIN public.contacts c
      ON public.normalize_company_key(c.company_name) >= mk.key
     AND public.normalize_company_key(c.company_name) < mk.key || chr(127)
    WHERE length(mk.key) >= 5

    UNION

    -- account/deal key starts with the contact key (equality on generated
    -- prefixes, uses idx_contacts_company_key)
    SELECT kp.account_id, c.id
    FROM key_prefixes kp
    JOIN public.contacts c
      ON public.normalize_company_key(c.company_name) = kp.pkey
  ),
  linked_pairs AS (
    SELECT c.account_id, c.id AS contact_id, 'direct_account'::text AS source
    FROM public.contacts c
    JOIN requested_accounts a ON a.id = c.account_id

    UNION ALL

    SELECT d.account_id, ds.contact_id, 'deal_stakeholder'::text
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

    SELECT d.account_id, cc.contact_id, 'source_campaign_contact'::text
    FROM accessible_deals d
    JOIN public.campaign_contacts cc ON cc.id = d.source_campaign_contact_id
    WHERE d.account_id IS NOT NULL

    UNION ALL

    SELECT cc.account_id, cc.contact_id, 'campaign_account'::text
    FROM public.campaign_contacts cc
    JOIN requested_accounts a ON a.id = cc.account_id
    WHERE cc.account_id IS NOT NULL

    UNION ALL

    SELECT cm.account_id, cm.contact_id, 'account_company_match'::text
    FROM company_matches cm

    UNION ALL

    SELECT d.account_id, c.id, 'deal_lead_name'::text
    FROM accessible_deals d
    JOIN public.contacts c ON lower(btrim(c.contact_name)) = lower(btrim(d.lead_name))
    WHERE d.account_id IS NOT NULL
      AND d.lead_name IS NOT NULL
      AND btrim(d.lead_name) <> ''
      AND lower(btrim(d.lead_name)) NOT IN ('-', 'na', 'n/a')
  ),
  grouped AS (
    SELECT lp.account_id, lp.contact_id, array_agg(DISTINCT lp.source ORDER BY lp.source) AS link_sources
    FROM linked_pairs lp
    WHERE lp.account_id IS NOT NULL AND lp.contact_id IS NOT NULL
    GROUP BY lp.account_id, lp.contact_id
  )
  SELECT
    g.account_id,
    c.id,
    c.contact_name,
    c.company_name,
    c.position,
    c.email,
    c.phone_no,
    c.account_id,
    g.link_sources
  FROM grouped g
  JOIN public.contacts c ON c.id = g.contact_id
  ORDER BY c.contact_name;
$function$;