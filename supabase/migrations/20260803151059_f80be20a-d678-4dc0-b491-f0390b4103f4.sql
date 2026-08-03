DROP POLICY IF EXISTS "Update active deals: owner/admin; archived: super_admin only" ON public.deals;

CREATE POLICY "Update deals: owner/admin active, super_admin archived"
ON public.deals
FOR UPDATE
TO authenticated
USING (
  ((archived_at IS NULL) AND (is_user_admin() OR (created_by = auth.uid())))
  OR ((archived_at IS NOT NULL) AND has_role(auth.uid(), 'super_admin'::user_role))
)
WITH CHECK (
  is_user_admin()
  OR (created_by = auth.uid())
  OR has_role(auth.uid(), 'super_admin'::user_role)
);