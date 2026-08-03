
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;
CREATE POLICY "Users can self-assign default user role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND role = 'user'::user_role);

DROP POLICY IF EXISTS "All authenticated can view suppression list" ON public.campaign_suppression_list;
CREATE POLICY "Admins or campaign owners can view suppression list"
ON public.campaign_suppression_list
FOR SELECT
TO authenticated
USING (
  public.is_user_admin()
  OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  OR (campaign_id IS NULL AND created_by = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated can view unsubscribe tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Admins or campaign managers view unsubscribe tokens"
ON public.email_unsubscribe_tokens
FOR SELECT
TO authenticated
USING (
  public.is_user_admin()
  OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
);

REVOKE SELECT ON public.campaign_webhooks FROM authenticated, anon;
GRANT SELECT (
  id, campaign_id, name, target_url, events, is_enabled,
  last_delivery_at, last_status, failure_count,
  created_by, created_at, updated_at
) ON public.campaign_webhooks TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read campaign materials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view campaign materials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload campaign materials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update campaign materials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete campaign materials" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own campaign materials" ON storage.objects;

CREATE POLICY "Campaign viewers can read campaign materials"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'campaign-materials' AND (
    public.is_user_admin()
    OR owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaign_materials cm
      WHERE cm.file_path = storage.objects.name
        AND public.can_view_campaign(cm.campaign_id)
    )
  )
);

CREATE POLICY "Authenticated users upload their own campaign materials"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'campaign-materials' AND owner = auth.uid());

CREATE POLICY "Campaign managers can update campaign materials"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'campaign-materials' AND (
    public.is_user_admin()
    OR owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaign_materials cm
      WHERE cm.file_path = storage.objects.name
        AND public.can_manage_campaign(cm.campaign_id)
    )
  )
);

CREATE POLICY "Campaign managers can delete campaign materials"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'campaign-materials' AND (
    public.is_user_admin()
    OR owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaign_materials cm
      WHERE cm.file_path = storage.objects.name
        AND public.can_manage_campaign(cm.campaign_id)
    )
  )
);
