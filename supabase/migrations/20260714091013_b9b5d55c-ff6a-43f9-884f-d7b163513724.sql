
-- ============================================================
-- merge_contacts_cascade: atomic merge for contact cleanup
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_contacts_cascade(
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
  v_stakeholders_repointed int := 0;
  v_stakeholders_dropped int := 0;
  v_campaign_contacts_repointed int := 0;
  v_campaign_contacts_dropped int := 0;
  v_campaign_comms int := 0;
  v_variants_repointed int := 0;
  v_variants_dropped int := 0;
  v_action_items int := 0;
  v_deleted int := 0;
  v_writable_fields text[] := ARRAY[
    'contact_name','company_name','email','phone_no','position',
    'contact_owner','account_id','linkedin','website','contact_source',
    'industry','region','description'
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

  -- Patch survivor with cherry-picked field values
  IF p_patch IS NOT NULL AND p_patch <> '{}'::jsonb THEN
    FOREACH v_key IN ARRAY v_writable_fields LOOP
      IF p_patch ? v_key THEN
        v_val := p_patch ->> v_key;
        EXECUTE format(
          'UPDATE public.contacts SET %I = $1, modified_time = now(), modified_by = $2 WHERE id = $3',
          v_key
        ) USING v_val, v_uid, p_survivor_id;
      END IF;
    END LOOP;
  END IF;

  -- 1. deal_stakeholders — dedupe by (deal_id, role) against survivor's set
  BEGIN
    WITH dupes AS (
      DELETE FROM public.deal_stakeholders ds
       WHERE ds.contact_id = ANY(p_loser_ids)
         AND EXISTS (
           SELECT 1 FROM public.deal_stakeholders s
            WHERE s.contact_id = p_survivor_id
              AND s.deal_id = ds.deal_id
              AND s.role IS NOT DISTINCT FROM ds.role
         )
       RETURNING 1
    ) SELECT count(*) INTO v_stakeholders_dropped FROM dupes;

    WITH upd AS (
      UPDATE public.deal_stakeholders SET contact_id = p_survivor_id
       WHERE contact_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_stakeholders_repointed FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_stakeholders_repointed := 0; v_stakeholders_dropped := 0;
  END;

  -- 2. campaign_contacts — dedupe by campaign_id
  BEGIN
    WITH dupes AS (
      DELETE FROM public.campaign_contacts cc
       WHERE cc.contact_id = ANY(p_loser_ids)
         AND cc.campaign_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.campaign_contacts s
            WHERE s.contact_id = p_survivor_id
              AND s.campaign_id = cc.campaign_id
         )
       RETURNING 1
    ) SELECT count(*) INTO v_campaign_contacts_dropped FROM dupes;

    WITH upd AS (
      UPDATE public.campaign_contacts SET contact_id = p_survivor_id
       WHERE contact_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_campaign_contacts_repointed FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_campaign_contacts_repointed := 0; v_campaign_contacts_dropped := 0;
  END;

  -- 3. campaign_communications — straight repoint (log rows, no natural key)
  BEGIN
    WITH upd AS (
      UPDATE public.campaign_communications SET contact_id = p_survivor_id
       WHERE contact_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_campaign_comms FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_campaign_comms := 0;
  END;

  -- 4. campaign_variant_assignments — dedupe by (campaign_id, variant_id)
  BEGIN
    WITH dupes AS (
      DELETE FROM public.campaign_variant_assignments va
       WHERE va.contact_id = ANY(p_loser_ids)
         AND EXISTS (
           SELECT 1 FROM public.campaign_variant_assignments s
            WHERE s.contact_id = p_survivor_id
              AND s.campaign_id IS NOT DISTINCT FROM va.campaign_id
              AND s.variant_id IS NOT DISTINCT FROM va.variant_id
         )
       RETURNING 1
    ) SELECT count(*) INTO v_variants_dropped FROM dupes;

    WITH upd AS (
      UPDATE public.campaign_variant_assignments SET contact_id = p_survivor_id
       WHERE contact_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_variants_repointed FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_variants_repointed := 0; v_variants_dropped := 0;
  END;

  -- 5. action_items pointing to loser contacts
  BEGIN
    WITH upd AS (
      UPDATE public.action_items
         SET module_id = p_survivor_id
       WHERE module_type = 'contacts'
         AND module_id = ANY(p_loser_ids)
       RETURNING 1
    ) SELECT count(*) INTO v_action_items FROM upd;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_action_items := 0;
  END;

  -- 6. delete losers
  WITH del AS (
    DELETE FROM public.contacts WHERE id = ANY(p_loser_ids) RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM del;

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'deleted', v_deleted,
    'stakeholders_repointed', v_stakeholders_repointed,
    'stakeholders_dropped', v_stakeholders_dropped,
    'campaign_contacts_repointed', v_campaign_contacts_repointed,
    'campaign_contacts_dropped', v_campaign_contacts_dropped,
    'campaign_communications', v_campaign_comms,
    'variants_repointed', v_variants_repointed,
    'variants_dropped', v_variants_dropped,
    'action_items', v_action_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contacts_cascade(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts_cascade(uuid, uuid[], jsonb) TO authenticated, service_role;

-- ============================================================
-- get_distinct_contact_owners: list distinct owners without hitting
-- the 1000-row PostgREST default cap.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_distinct_contact_owners()
RETURNS TABLE(contact_owner uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.contact_owner
    FROM public.contacts c
   WHERE c.contact_owner IS NOT NULL
   ORDER BY c.contact_owner;
$$;

REVOKE ALL ON FUNCTION public.get_distinct_contact_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_contact_owners() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS contacts_contact_owner_idx
  ON public.contacts (contact_owner)
  WHERE contact_owner IS NOT NULL;
