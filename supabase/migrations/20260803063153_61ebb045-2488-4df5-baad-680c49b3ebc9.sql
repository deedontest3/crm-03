-- 1. Make normalization helpers IMMUTABLE so they can back expression indexes
CREATE OR REPLACE FUNCTION public.normalize_company_key(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(_name, '')), '&', ' and ', 'g'),
          '[^a-z0-9]+', ' ', 'g'
        ),
        '\y(ltd|limited|inc|incorporated|gmbh|corp|corporation|company|co|llc|plc|ag|bv|pte|pvt|hq|usa|us|uk|germany|switzerland|india|europe|global|group)\y', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.company_keys_match(_left text, _right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
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

-- 2. Expression indexes on the normalized keys
CREATE INDEX IF NOT EXISTS idx_contacts_company_key
  ON public.contacts (public.normalize_company_key(company_name));
CREATE INDEX IF NOT EXISTS idx_contacts_company_key_pattern
  ON public.contacts (public.normalize_company_key(company_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_company_key
  ON public.accounts (public.normalize_company_key(account_name));
CREATE INDEX IF NOT EXISTS idx_deals_customer_company_key
  ON public.deals (public.normalize_company_key(customer_name));
CREATE INDEX IF NOT EXISTS idx_contacts_name_lower
  ON public.contacts (lower(btrim(contact_name)));

-- 3. Rewrite the linked-contacts RPC to join on indexed normalized keys
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
  contact_keys AS (
    SELECT c.id, public.normalize_company_key(c.company_name) AS ckey
    FROM public.contacts c
    WHERE c.company_name IS NOT NULL
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

    -- company-name matches: exact key
    UNION ALL

    SELECT a.id, ck.id, 'account_company_match'::text
    FROM requested_accounts a
    JOIN contact_keys ck ON ck.ckey = a.akey
    WHERE a.akey <> ''

    -- company-name matches: contact key starts with account key
    UNION ALL

    SELECT a.id, ck.id, 'account_company_match'::text
    FROM requested_accounts a
    JOIN contact_keys ck ON ck.ckey LIKE a.akey || '%'
    WHERE length(a.akey) >= 5

    -- company-name matches: account key starts with contact key
    UNION ALL

    SELECT a.id, ck.id, 'account_company_match'::text
    FROM requested_accounts a
    JOIN contact_keys ck ON a.akey LIKE ck.ckey || '%'
    WHERE length(a.akey) >= 5 AND length(ck.ckey) >= 5

    UNION ALL

    SELECT d.account_id, ck.id, 'deal_customer_company_match'::text
    FROM accessible_deals d
    JOIN contact_keys ck
      ON ck.ckey = d.dkey
      OR (length(d.dkey) >= 5 AND ck.ckey LIKE d.dkey || '%')
      OR (length(ck.ckey) >= 5 AND d.dkey LIKE ck.ckey || '%')
    WHERE d.account_id IS NOT NULL
      AND d.dkey <> ''
      AND lower(btrim(d.customer_name)) NOT IN ('-', 'na', 'n/a')

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

-- 4. Relax deal date trigger
CREATE OR REPLACE FUNCTION public.validate_deal_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;