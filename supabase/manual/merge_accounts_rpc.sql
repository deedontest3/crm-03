-- ============================================================
-- Manual migration for the EXTERNAL Supabase project
-- (emcppynoiprlowuowgan). Run this from the Supabase SQL editor.
--
-- Adds:
--   1. public.merge_accounts(uuid, uuid[], jsonb) — atomic merge
--   2. accounts_lower_name_idx — case-insensitive lookup index
--   3. accounts_account_owner_idx — owner filter/cleanup index
-- ============================================================

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

  -- Best-effort admin check; if is_user_admin() isn't present, fall back to owner check
  BEGIN
    v_is_admin := public.is_user_admin();
  EXCEPTION WHEN undefined_function THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = ANY(p_loser_ids || ARRAY[p_survivor_id])
         AND (COALESCE(account_owner,'') <> v_uid::text
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
        EXECUTE format(
          'UPDATE public.accounts SET %I = $1, modified_time = now(), modified_by = $2 WHERE id = $3',
          v_key
        ) USING v_val, v_uid, p_survivor_id;
      END IF;
    END LOOP;
  END IF;

  SELECT account_name INTO v_survivor_name FROM public.accounts WHERE id = p_survivor_id;

  WITH upd AS (
    UPDATE public.deals
       SET account_id = p_survivor_id,
           customer_name = COALESCE(v_survivor_name, customer_name)
     WHERE account_id = ANY(p_loser_ids)
     RETURNING 1
  ) SELECT count(*) INTO v_deals FROM upd;

  WITH upd AS (
    UPDATE public.contacts
       SET account_id = p_survivor_id,
           company_name = COALESCE(v_survivor_name, company_name)
     WHERE account_id = ANY(p_loser_ids)
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

CREATE INDEX IF NOT EXISTS accounts_lower_name_idx
  ON public.accounts (lower(account_name));

CREATE INDEX IF NOT EXISTS accounts_account_owner_idx
  ON public.accounts (account_owner)
  WHERE account_owner IS NOT NULL;