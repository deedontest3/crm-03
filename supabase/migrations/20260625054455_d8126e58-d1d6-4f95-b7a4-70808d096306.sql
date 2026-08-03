
-- =====================================================================
-- 1. campaign_send_job_items: scope SELECT policy to authenticated
-- =====================================================================
DROP POLICY IF EXISTS "Managers can view send job items" ON public.campaign_send_job_items;
CREATE POLICY "Managers can view send job items"
  ON public.campaign_send_job_items
  FOR SELECT
  TO authenticated
  USING (can_manage_campaign(campaign_id));

-- =====================================================================
-- 2. campaign_unmatched_replies: allow managers to see/update NULL matched rows
-- =====================================================================
DROP POLICY IF EXISTS "Admins or campaign owners view unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Admins or campaign owners view unmatched"
  ON public.campaign_unmatched_replies
  FOR SELECT
  TO authenticated
  USING (
    is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND can_view_campaign(matched_campaign_id))
    OR (matched_campaign_id IS NULL AND EXISTS (
      SELECT 1 FROM public.campaigns c WHERE can_manage_campaign(c.id)
    ))
  );

DROP POLICY IF EXISTS "Admins or campaign owners update unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Admins or campaign owners update unmatched"
  ON public.campaign_unmatched_replies
  FOR UPDATE
  TO authenticated
  USING (
    is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND can_manage_campaign(matched_campaign_id))
    OR (matched_campaign_id IS NULL AND EXISTS (
      SELECT 1 FROM public.campaigns c WHERE can_manage_campaign(c.id)
    ))
  )
  WITH CHECK (
    is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND can_manage_campaign(matched_campaign_id))
    OR (matched_campaign_id IS NULL AND EXISTS (
      SELECT 1 FROM public.campaigns c WHERE can_manage_campaign(c.id)
    ))
  );

-- =====================================================================
-- 3. deal_action_items: tighten INSERT to require access to deal
-- =====================================================================
DROP POLICY IF EXISTS "Users can create action items for deals" ON public.deal_action_items;
CREATE POLICY "Users can create action items for deals"
  ON public.deal_action_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND can_view_deal(deal_id)
  );

-- =====================================================================
-- 4. deal_offered_schedule: require deal ownership / admin on all CRUD
-- =====================================================================
DROP POLICY IF EXISTS dos_select ON public.deal_offered_schedule;
DROP POLICY IF EXISTS dos_insert ON public.deal_offered_schedule;
DROP POLICY IF EXISTS dos_update ON public.deal_offered_schedule;
DROP POLICY IF EXISTS dos_delete ON public.deal_offered_schedule;

CREATE POLICY dos_select ON public.deal_offered_schedule
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_offered_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY dos_insert ON public.deal_offered_schedule
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_offered_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY dos_update ON public.deal_offered_schedule
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_offered_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_offered_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY dos_delete ON public.deal_offered_schedule
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_offered_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

-- =====================================================================
-- 5. deal_revenue_schedule: require deal ownership / admin on all CRUD
-- =====================================================================
DROP POLICY IF EXISTS drs_select ON public.deal_revenue_schedule;
DROP POLICY IF EXISTS drs_insert ON public.deal_revenue_schedule;
DROP POLICY IF EXISTS drs_update ON public.deal_revenue_schedule;
DROP POLICY IF EXISTS drs_delete ON public.deal_revenue_schedule;

CREATE POLICY drs_select ON public.deal_revenue_schedule
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_revenue_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY drs_insert ON public.deal_revenue_schedule
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_revenue_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY drs_update ON public.deal_revenue_schedule
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_revenue_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_revenue_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

CREATE POLICY drs_delete ON public.deal_revenue_schedule
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_revenue_schedule.deal_id
      AND (is_user_admin() OR d.created_by = auth.uid())
  ));

-- =====================================================================
-- 6. lead_action_items: tighten INSERT to require access to lead
-- =====================================================================
DROP POLICY IF EXISTS "Users can create action items for leads" ON public.lead_action_items;
CREATE POLICY "Users can create action items for leads"
  ON public.lead_action_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND can_view_lead(lead_id)
  );

-- =====================================================================
-- 7. profiles: restrict full row to self/admin, expose safe directory view
-- =====================================================================

-- Replace permissive SELECT with self/admin-only
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR is_user_admin());

-- Public directory view (id, name, email, avatar only) — excludes phone,
-- email_signature, deleted_email, timezone, and any other sensitive fields.
-- View runs with definer rights so authenticated users get directory data
-- even though the base table SELECT is now self/admin only.
CREATE OR REPLACE VIEW public.profiles_public AS
  SELECT
    id,
    full_name,
    "Email ID",
    avatar_url
  FROM public.profiles;

REVOKE ALL ON public.profiles_public FROM PUBLIC, anon;
GRANT SELECT ON public.profiles_public TO authenticated;
GRANT SELECT ON public.profiles_public TO service_role;

COMMENT ON VIEW public.profiles_public IS
  'Safe directory view of profiles: only id, full_name, "Email ID", avatar_url. Excludes phone, email_signature, deleted_email, timezone, and other PII. Use this view for cross-user lookups; query profiles directly only for self/admin contexts.';
