-- 1) campaign_send_job_items: only campaign managers can read recipient PII/body
DROP POLICY IF EXISTS "View send job items for accessible campaigns" ON public.campaign_send_job_items;
CREATE POLICY "Managers can view send job items"
ON public.campaign_send_job_items
FOR SELECT
USING (public.can_manage_campaign(campaign_id));

-- 2) campaign_suppression_list: only admins can add global (campaign_id IS NULL) entries
DROP POLICY IF EXISTS "Admins or campaign owner can add suppression" ON public.campaign_suppression_list;
CREATE POLICY "Admins or campaign manager can add suppression"
ON public.campaign_suppression_list
FOR INSERT
WITH CHECK (
  auth.uid() = created_by
  AND (
    public.is_user_admin()
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  )
);