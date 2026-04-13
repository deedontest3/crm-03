
CREATE OR REPLACE FUNCTION public.can_view_campaign(_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = _campaign_id
      AND (
        public.is_current_user_admin()
        OR c.created_by = auth.uid()
        OR c.owner = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_campaign(_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = _campaign_id
      AND (
        public.is_current_user_admin()
        OR c.created_by = auth.uid()
        OR c.owner = auth.uid()
      )
  );
$$;
