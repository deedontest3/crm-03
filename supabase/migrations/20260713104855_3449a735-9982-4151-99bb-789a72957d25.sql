
-- =====================================================================
-- 1. delete_accounts_cascade — atomic bulk delete for the Accounts module.
--    Replaces the multi-step client-side cascade in BulkDeleteAccountsDialog
--    so a partial failure can no longer leave orphaned contacts/deals.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delete_accounts_cascade(
  p_account_ids uuid[],
  p_contact_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_contact_detach_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_lead_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_lead_detach_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_campaign_contact_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_campaign_contact_detach_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_deal_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_deal_detach_ids uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_deleted_accounts int := 0;
  v_deleted_contacts int := 0;
  v_detached_contacts int := 0;
  v_deleted_leads int := 0;
  v_detached_leads int := 0;
  v_deleted_cc int := 0;
  v_detached_cc int := 0;
  v_deleted_deals int := 0;
  v_detached_deals int := 0;
  v_deleted_camp_links int := 0;
  v_deleted_actions int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_account_ids IS NULL OR array_length(p_account_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no account ids provided';
  END IF;

  BEGIN
    v_is_admin := public.is_user_admin();
  EXCEPTION WHEN undefined_function THEN
    v_is_admin := false;
  END;

  -- Ownership gate: non-admins may only delete accounts they own or created.
  IF NOT v_is_admin THEN
    IF EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = ANY(p_account_ids)
         AND (COALESCE(account_owner,'') <> v_uid::text
              AND created_by IS DISTINCT FROM v_uid)
    ) THEN
      RAISE EXCEPTION 'not permitted to delete one or more of these accounts' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Contacts
  IF array_length(p_contact_delete_ids, 1) IS NOT NULL THEN
    WITH d AS (DELETE FROM public.contacts WHERE id = ANY(p_contact_delete_ids) RETURNING 1)
    SELECT count(*) INTO v_deleted_contacts FROM d;
  END IF;
  IF array_length(p_contact_detach_ids, 1) IS NOT NULL THEN
    WITH u AS (UPDATE public.contacts SET account_id = NULL WHERE id = ANY(p_contact_detach_ids) RETURNING 1)
    SELECT count(*) INTO v_detached_contacts FROM u;
  END IF;

  -- Leads
  BEGIN
    IF array_length(p_lead_delete_ids, 1) IS NOT NULL THEN
      WITH d AS (DELETE FROM public.leads WHERE id = ANY(p_lead_delete_ids) RETURNING 1)
      SELECT count(*) INTO v_deleted_leads FROM d;
    END IF;
    IF array_length(p_lead_detach_ids, 1) IS NOT NULL THEN
      WITH u AS (UPDATE public.leads SET account_id = NULL WHERE id = ANY(p_lead_detach_ids) RETURNING 1)
      SELECT count(*) INTO v_detached_leads FROM u;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_deleted_leads := 0; v_detached_leads := 0;
  END;

  -- Campaign contacts
  BEGIN
    IF array_length(p_campaign_contact_delete_ids, 1) IS NOT NULL THEN
      WITH d AS (DELETE FROM public.campaign_contacts WHERE id = ANY(p_campaign_contact_delete_ids) RETURNING 1)
      SELECT count(*) INTO v_deleted_cc FROM d;
    END IF;
    IF array_length(p_campaign_contact_detach_ids, 1) IS NOT NULL THEN
      WITH u AS (UPDATE public.campaign_contacts SET account_id = NULL WHERE id = ANY(p_campaign_contact_detach_ids) RETURNING 1)
      SELECT count(*) INTO v_detached_cc FROM u;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_deleted_cc := 0; v_detached_cc := 0;
  END;

  -- Deals
  IF array_length(p_deal_delete_ids, 1) IS NOT NULL THEN
    WITH d AS (DELETE FROM public.deals WHERE id = ANY(p_deal_delete_ids) RETURNING 1)
    SELECT count(*) INTO v_deleted_deals FROM d;
  END IF;
  IF array_length(p_deal_detach_ids, 1) IS NOT NULL THEN
    WITH u AS (UPDATE public.deals SET account_id = NULL WHERE id = ANY(p_deal_detach_ids) RETURNING 1)
    SELECT count(*) INTO v_detached_deals FROM u;
  END IF;

  -- Campaign_accounts (link table) — always cleared for these accounts.
  BEGIN
    WITH d AS (
      DELETE FROM public.campaign_accounts
       WHERE account_id = ANY(p_account_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_deleted_camp_links FROM d;
  EXCEPTION WHEN undefined_table THEN
    v_deleted_camp_links := 0;
  END;

  -- Account-scoped action items — always deleted.
  BEGIN
    WITH d AS (
      DELETE FROM public.action_items
       WHERE module_type = 'accounts' AND module_id = ANY(p_account_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_deleted_actions FROM d;
  EXCEPTION WHEN undefined_table THEN
    v_deleted_actions := 0;
  END;

  -- Finally, the accounts themselves.
  WITH d AS (
    DELETE FROM public.accounts WHERE id = ANY(p_account_ids) RETURNING 1
  ) SELECT count(*) INTO v_deleted_accounts FROM d;

  RETURN jsonb_build_object(
    'accounts_deleted', v_deleted_accounts,
    'contacts_deleted', v_deleted_contacts,
    'contacts_detached', v_detached_contacts,
    'leads_deleted', v_deleted_leads,
    'leads_detached', v_detached_leads,
    'campaign_contacts_deleted', v_deleted_cc,
    'campaign_contacts_detached', v_detached_cc,
    'deals_deleted', v_deleted_deals,
    'deals_detached', v_detached_deals,
    'campaign_account_links_deleted', v_deleted_camp_links,
    'action_items_deleted', v_deleted_actions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_accounts_cascade(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_accounts_cascade(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) TO authenticated;


-- =====================================================================
-- 2. get_account_deal_counts — one-pass count of deals linked to each account.
--    Replaces getAllAccountDealCounts which downloaded the entire linking
--    universe on every refresh. Covers: direct deal.account_id, contact
--    account via stakeholders / direct contact fields, source campaign
--    contact account, and exact-name customer_name/lead_name match.
--    Fuzzy multi-token matching (used by the drill-down list) is
--    intentionally not replicated here — this is a fast overview.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_account_deal_counts()
RETURNS TABLE (account_id uuid, deal_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate_deals AS (
    -- 1. Direct account_id
    SELECT d.id AS deal_id, d.account_id AS acct
      FROM public.deals d
     WHERE d.account_id IS NOT NULL
    UNION
    -- 2. Direct contact fields on the deal
    SELECT d.id, c.account_id
      FROM public.deals d
      JOIN public.contacts c
        ON c.id IN (
          d.budget_owner_contact_id, d.champion_contact_id,
          d.objector_contact_id, d.influencer_contact_id
        )
     WHERE c.account_id IS NOT NULL
    UNION
    -- 3. Deal stakeholders → contact account
    SELECT ds.deal_id, c.account_id
      FROM public.deal_stakeholders ds
      JOIN public.contacts c ON c.id = ds.contact_id
     WHERE c.account_id IS NOT NULL
    UNION
    -- 4. Source campaign contact account
    SELECT d.id, cc.account_id
      FROM public.deals d
      JOIN public.campaign_contacts cc ON cc.id = d.source_campaign_contact_id
     WHERE cc.account_id IS NOT NULL
    UNION
    -- 5. Exact-name customer_name match (fallback for legacy deals)
    SELECT d.id, a.id
      FROM public.deals d
      JOIN public.accounts a
        ON a.account_name IS NOT NULL
       AND d.customer_name IS NOT NULL
       AND lower(btrim(a.account_name)) = lower(btrim(d.customer_name))
     WHERE d.account_id IS NULL
  )
  SELECT acct AS account_id, count(DISTINCT deal_id)::bigint AS deal_count
    FROM candidate_deals
   WHERE acct IS NOT NULL
   GROUP BY acct;
$$;

REVOKE ALL ON FUNCTION public.get_account_deal_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.get_account_deal_counts() TO authenticated;
