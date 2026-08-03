-- Keep server-side admin helpers aligned with the current role model.
-- Several RLS policies and edge-function checks depend on is_user_admin();
-- super_admin must pass those admin-level checks too.

CREATE OR REPLACE FUNCTION public.is_user_admin(user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(public.get_user_role(user_id) IN ('admin', 'super_admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_user_admin(auth.uid());
$$;