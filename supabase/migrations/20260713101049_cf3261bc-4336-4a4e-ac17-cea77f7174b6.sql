
CREATE OR REPLACE FUNCTION public.merge_accounts(
  p_survivor_id uuid,
  p_loser_ids uuid[],
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_survivor_name text;
  v_deals int := 0;
  v_contacts int := 0;
  v_leads int := 0;
  v_campaigns_repointed int := 0;
  v_campaigns_dropped int := 0;
  v_campaign_contacts int := 0;
  v_campaign_comms int := 0;
  v_action_items int := 0;
  v_deleted int := 0;
  v_owner_ok boolean;
  v_writable_fields text[] := ARRAY[
    'account_name','industry','country','phone','website','description',
    'account_owner','company_type','region','status'
  ];
  v_key text;
  v_val text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_survivor_id IS NULL OR p_loser_ids IS NULL OR array_length(p_loser_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'survivor and loser ids are required';
  END IF;
  IF p_survivor_id = ANY(p_loser_ids) THEN
    RAISE EXCEPTION 'survivor cannot also be a loser';
  END IF;

  BEGIN
    v_is_admin := public.is_user_admin();
  EXCEPTION WHEN undefined_function THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = ANY(p_loser_ids || ARRAY[p_survivor_id])
         AND (account_owner IS DISTINCT FROM v_uid
              AND created_by IS DISTINCT FROM v_uid)
    ) INTO v_owner_ok;
    IF NOT v_owner_ok THEN
      RAISE EXCEPTION 'not permitted to merge these accounts' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_patch IS NOT NULL AND p_patch <> '{}'::jsonb THEN
    FOREACH v_key IN ARRAY v_writable_fields LOOP
      IF p_patch ? v_key THEN
        v_val := p_patch ->> v_key;
        IF v_key IN ('account_owner') THEN
          EXECUTE format(
            'UPDATE public.accounts SET %I = $1::uuid, modified_time = now(), modified_by = $2 WHERE id = $3',
            v_key
          ) USING v_val, v_uid, p_survivor_id;
        ELSE
          EXECUTE format(
            'UPDATE public.accounts SET %I = $1, modified_time = now(), modified_by = $2 WHERE id = $3',
            v_key
          ) USING v_val, v_uid, p_survivor_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  SELECT account_name INTO v_survivor_name FROM public.accounts WHERE id = p_survivor_id;

  WITH loser_names AS (
    SELECT id, NULLIF(TRIM(account_name), '') AS n
      FROM public.accounts
     WHERE id = ANY(p_loser_ids)
  ), upd AS (
    UPDATE public.deals d
       SET account_id = p_survivor_id,
           customer_name = CASE
             WHEN d.customer_name IS NULL
               OR TRIM(d.customer_name) = ''
               OR lower(TRIM(d.customer_name)) = lower(TRIM(COALESCE(ln.n, '')))
             THEN COALESCE(v_survivor_name, d.customer_name)
             ELSE d.customer_name
           END
      FROM loser_names ln
     WHERE d.account_id = ln.id
     RETURNING 1
  ) SELECT count(*) INTO v_deals FROM upd;

  WITH loser_names AS (
    SELECT id, NULLIF(TRIM(account_name), '') AS n
      FROM public.accounts
     WHERE id = ANY(p_loser_ids)
  ), upd AS (
    UPDATE public.contacts c
       SET account_id = p_survivor_id,
           company_name = CASE
             WHEN c.company_name IS NULL
               OR TRIM(c.company_name) = ''
               OR lower(TRIM(c.company_name)) = lower(TRIM(COALESCE(ln.n, '')))
             THEN COALESCE(v_survivor_name, c.company_name)
             ELSE c.company_name
           END
      FROM loser_names ln
     WHERE c.account_id = ln.id
     RETURNING 1
  ) SELECT count(*) INTO v_contacts FROM upd;

  BEGIN
    WITH upd AS (
      UPDATE public.leads SET account_id = p_survivor_id
       WHERE account_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_leads FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_leads := 0;
  END;

  BEGIN
    WITH dupes AS (
      DELETE FROM public.campaign_accounts ca
       WHERE ca.account_id = ANY(p_loser_ids)
         AND EXISTS (
           SELECT 1 FROM public.campaign_accounts s
            WHERE s.account_id = p_survivor_id
              AND s.campaign_id = ca.campaign_id
         )
       RETURNING 1
    ) SELECT count(*) INTO v_campaigns_dropped FROM dupes;

    WITH upd AS (
      UPDATE public.campaign_accounts
         SET account_id = p_survivor_id
       WHERE account_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_campaigns_repointed FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_campaigns_repointed := 0; v_campaigns_dropped := 0;
  END;

  BEGIN
    WITH upd AS (
      UPDATE public.campaign_contacts SET account_id = p_survivor_id
       WHERE account_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_campaign_contacts FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_campaign_contacts := 0;
  END;

  BEGIN
    WITH upd AS (
      UPDATE public.campaign_communications SET account_id = p_survivor_id
       WHERE account_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_campaign_comms FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_campaign_comms := 0;
  END;

  BEGIN
    WITH upd AS (
      UPDATE public.action_items
         SET module_id = p_survivor_id
       WHERE module_type = 'accounts'
         AND module_id = ANY(p_loser_ids)
         AND archived_at IS NULL
       RETURNING 1
    ) SELECT count(*) INTO v_action_items FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_action_items := 0;
  END;

  WITH del AS (
    DELETE FROM public.accounts WHERE id = ANY(p_loser_ids) RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM del;

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'deleted', v_deleted,
    'deals', v_deals,
    'contacts', v_contacts,
    'leads', v_leads,
    'campaigns_repointed', v_campaigns_repointed,
    'campaigns_dropped', v_campaigns_dropped,
    'campaign_contacts', v_campaign_contacts,
    'campaign_communications', v_campaign_comms,
    'action_items', v_action_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_accounts(uuid, uuid[], jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_accounts(uuid, uuid[], jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_distinct_account_owners()
RETURNS TABLE(account_owner uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.account_owner
    FROM public.accounts a
   WHERE a.account_owner IS NOT NULL
   ORDER BY a.account_owner;
$$;

REVOKE ALL ON FUNCTION public.get_distinct_account_owners() FROM public;
GRANT EXECUTE ON FUNCTION public.get_distinct_account_owners() TO authenticated;

CREATE OR REPLACE FUNCTION public.search_accounts(
  p_query text DEFAULT '',
  p_limit int DEFAULT 50
) RETURNS TABLE(
  id uuid,
  account_name text,
  region text,
  industry text,
  currency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.account_name, a.region, a.industry, a.currency
    FROM public.accounts a
   WHERE COALESCE(p_query, '') = ''
      OR a.account_name ILIKE '%' || p_query || '%'
      OR COALESCE(a.region, '')   ILIKE '%' || p_query || '%'
      OR COALESCE(a.industry, '') ILIKE '%' || p_query || '%'
   ORDER BY
     CASE WHEN COALESCE(p_query, '') = '' THEN 0
          WHEN a.account_name ILIKE p_query || '%' THEN 1
          WHEN a.account_name ILIKE '%' || p_query || '%' THEN 2
          ELSE 3 END,
     a.account_name
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

REVOKE ALL ON FUNCTION public.search_accounts(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.search_accounts(text, int) TO authenticated;

CREATE INDEX IF NOT EXISTS accounts_lower_name_idx
  ON public.accounts (lower(account_name));

CREATE INDEX IF NOT EXISTS accounts_account_owner_idx
  ON public.accounts (account_owner)
  WHERE account_owner IS NOT NULL;
