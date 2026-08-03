
-- 1) Fix delete trigger: run BEFORE DELETE so activity log insert happens before CASCADE removes children/parent.
DROP TRIGGER IF EXISTS trg_log_deal_changes_del ON public.deals;
CREATE TRIGGER trg_log_deal_changes_del
  BEFORE DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_changes();

-- 2) Archive columns
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archive_reason text NULL;

CREATE INDEX IF NOT EXISTS deals_archived_at_idx
  ON public.deals (archived_at)
  WHERE archived_at IS NOT NULL;

-- 3) Replace RLS policies
DROP POLICY IF EXISTS "Owner or admin can view deals" ON public.deals;
DROP POLICY IF EXISTS "Users can update their own deals, admins can update all" ON public.deals;
DROP POLICY IF EXISTS "Users can delete their own deals, admins can delete all" ON public.deals;

CREATE POLICY "View deals: active for owner/admin, archived for super_admin"
  ON public.deals FOR SELECT
  USING (
    (archived_at IS NULL AND (public.is_user_admin() OR created_by = auth.uid()))
    OR
    (archived_at IS NOT NULL AND public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Update active deals: owner/admin; archived: super_admin only"
  ON public.deals FOR UPDATE
  USING (
    (archived_at IS NULL AND (public.is_user_admin() OR created_by = auth.uid()))
    OR
    (archived_at IS NOT NULL AND public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Hard delete deals: super_admin only"
  ON public.deals FOR DELETE
  USING (public.has_role(auth.uid(), 'super_admin'));
