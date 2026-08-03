
-- =============================================================
-- get_contact_deal_counts: fast per-contact deal count for the visible page
-- Union of:
--   - deal_stakeholders.contact_id
--   - deals.{budget_owner,champion,objector,influencer}_contact_id
--   - campaign_contacts.contact_id via deals.source_campaign_contact_id
--   - deals.lead_name matched by normalized name (account-scoped when possible)
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_contact_deal_counts(_contact_ids uuid[])
RETURNS TABLE(contact_id uuid, deal_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH targets AS (
    SELECT c.id AS contact_id,
           c.contact_name,
           c.account_id,
           lower(regexp_replace(coalesce(c.contact_name, ''), '[^a-z0-9]+', ' ', 'gi')) AS norm_name
    FROM public.contacts c
    WHERE c.id = ANY(_contact_ids)
  ),
  direct_stakeholders AS (
    SELECT DISTINCT s.contact_id, s.deal_id
    FROM public.deal_stakeholders s
    WHERE s.contact_id = ANY(_contact_ids)
  ),
  direct_role AS (
    SELECT t.contact_id, d.id AS deal_id
    FROM public.deals d
    JOIN targets t ON t.contact_id IN (
      d.budget_owner_contact_id, d.champion_contact_id,
      d.objector_contact_id, d.influencer_contact_id
    )
  ),
  campaign_bridge AS (
    SELECT cc.contact_id, d.id AS deal_id
    FROM public.deals d
    JOIN public.campaign_contacts cc ON cc.id = d.source_campaign_contact_id
    WHERE cc.contact_id = ANY(_contact_ids)
  ),
  lead_match AS (
    SELECT t.contact_id, d.id AS deal_id
    FROM public.deals d
    JOIN targets t ON t.norm_name <> ''
      AND lower(regexp_replace(coalesce(d.lead_name, ''), '[^a-z0-9]+', ' ', 'gi')) = t.norm_name
      AND (d.account_id IS NULL OR t.account_id IS NULL OR d.account_id = t.account_id)
  ),
  unioned AS (
    SELECT contact_id, deal_id FROM direct_stakeholders
    UNION SELECT contact_id, deal_id FROM direct_role
    UNION SELECT contact_id, deal_id FROM campaign_bridge
    UNION SELECT contact_id, deal_id FROM lead_match
  )
  SELECT t.contact_id, COUNT(u.deal_id)::bigint
  FROM targets t
  LEFT JOIN unioned u ON u.contact_id = t.contact_id
  GROUP BY t.contact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_contact_deal_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_deal_counts(uuid[]) TO authenticated, service_role;

-- =============================================================
-- get_contact_ids_with_deals: set of contact ids with any deal linkage
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_contact_ids_with_deals()
RETURNS TABLE(contact_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT s.contact_id
    FROM public.deal_stakeholders s
    WHERE s.contact_id IS NOT NULL
  UNION
  SELECT DISTINCT cc.contact_id
    FROM public.campaign_contacts cc
    JOIN public.deals d ON d.source_campaign_contact_id = cc.id
    WHERE cc.contact_id IS NOT NULL
  UNION
  SELECT DISTINCT unnest(ARRAY[
    d.budget_owner_contact_id, d.champion_contact_id,
    d.objector_contact_id, d.influencer_contact_id
  ])
    FROM public.deals d
  UNION
  SELECT DISTINCT c.id
    FROM public.contacts c
    JOIN public.deals d
      ON lower(regexp_replace(coalesce(d.lead_name, ''), '[^a-z0-9]+', ' ', 'gi'))
       = lower(regexp_replace(coalesce(c.contact_name, ''), '[^a-z0-9]+', ' ', 'gi'))
      AND lower(regexp_replace(coalesce(c.contact_name, ''), '[^a-z0-9]+', ' ', 'gi')) <> ''
      AND (d.account_id IS NULL OR c.account_id IS NULL OR d.account_id = c.account_id);
$$;

REVOKE ALL ON FUNCTION public.get_contact_ids_with_deals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_ids_with_deals() TO authenticated, service_role;

-- =============================================================
-- delete_contacts_cascade: single-transaction bulk delete
-- =============================================================
CREATE OR REPLACE FUNCTION public.delete_contacts_cascade(
  _contact_ids uuid[],
  _delete_deal_ids uuid[] DEFAULT ARRAY[]::uuid[],
  _detach_deal_ids uuid[] DEFAULT ARRAY[]::uuid[],
  _delete_comm_ids uuid[] DEFAULT ARRAY[]::uuid[],
  _detach_comm_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_stake int := 0;
  n_camp int := 0;
  n_var int := 0;
  n_comm_del int := 0;
  n_comm_upd int := 0;
  n_ai int := 0;
  n_deals_del int := 0;
  n_deals_upd int := 0;
  n_contacts int := 0;
BEGIN
  -- Link tables — always deleted with the contact
  WITH d AS (DELETE FROM public.deal_stakeholders WHERE contact_id = ANY(_contact_ids) RETURNING 1)
  SELECT COUNT(*) INTO n_stake FROM d;

  WITH d AS (DELETE FROM public.campaign_contacts WHERE contact_id = ANY(_contact_ids) RETURNING 1)
  SELECT COUNT(*) INTO n_camp FROM d;

  WITH d AS (DELETE FROM public.campaign_variant_assignments WHERE contact_id = ANY(_contact_ids) RETURNING 1)
  SELECT COUNT(*) INTO n_var FROM d;

  WITH d AS (DELETE FROM public.action_items WHERE module_type = 'contacts' AND module_id::uuid = ANY(_contact_ids) RETURNING 1)
  SELECT COUNT(*) INTO n_ai FROM d;

  -- Communications: caller decides which to delete vs which to detach (contact_id = NULL)
  IF array_length(_delete_comm_ids, 1) > 0 THEN
    WITH d AS (DELETE FROM public.campaign_communications WHERE id = ANY(_delete_comm_ids) RETURNING 1)
    SELECT COUNT(*) INTO n_comm_del FROM d;
  END IF;

  IF array_length(_detach_comm_ids, 1) > 0 THEN
    WITH u AS (UPDATE public.campaign_communications SET contact_id = NULL WHERE id = ANY(_detach_comm_ids) RETURNING 1)
    SELECT COUNT(*) INTO n_comm_upd FROM u;
  END IF;

  -- Deals: caller decides which to delete vs which to detach (null out contact-role FKs)
  IF array_length(_delete_deal_ids, 1) > 0 THEN
    WITH d AS (DELETE FROM public.deals WHERE id = ANY(_delete_deal_ids) RETURNING 1)
    SELECT COUNT(*) INTO n_deals_del FROM d;
  END IF;

  IF array_length(_detach_deal_ids, 1) > 0 THEN
    WITH u AS (
      UPDATE public.deals SET
        budget_owner_contact_id = CASE WHEN budget_owner_contact_id = ANY(_contact_ids) THEN NULL ELSE budget_owner_contact_id END,
        champion_contact_id     = CASE WHEN champion_contact_id     = ANY(_contact_ids) THEN NULL ELSE champion_contact_id END,
        objector_contact_id     = CASE WHEN objector_contact_id     = ANY(_contact_ids) THEN NULL ELSE objector_contact_id END,
        influencer_contact_id   = CASE WHEN influencer_contact_id   = ANY(_contact_ids) THEN NULL ELSE influencer_contact_id END
      WHERE id = ANY(_detach_deal_ids)
      RETURNING 1
    )
    SELECT COUNT(*) INTO n_deals_upd FROM u;
  END IF;

  -- Finally, the contacts themselves
  WITH d AS (DELETE FROM public.contacts WHERE id = ANY(_contact_ids) RETURNING 1)
  SELECT COUNT(*) INTO n_contacts FROM d;

  RETURN jsonb_build_object(
    'contacts', n_contacts,
    'stakeholders', n_stake,
    'campaign_contacts', n_camp,
    'variant_assignments', n_var,
    'action_items', n_ai,
    'communications_deleted', n_comm_del,
    'communications_detached', n_comm_upd,
    'deals_deleted', n_deals_del,
    'deals_detached', n_deals_upd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_contacts_cascade(uuid[], uuid[], uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_contacts_cascade(uuid[], uuid[], uuid[], uuid[], uuid[]) TO authenticated, service_role;
