
-- 1) Drop policies & defaults that reference the user_role enum so we can recreate it
DROP POLICY IF EXISTS "Users can self-assign default user role" ON public.user_roles;
ALTER TABLE public.user_roles ALTER COLUMN role DROP DEFAULT;

-- 2) Update decide_campaign_approval to remove 'manager' (no users hold it; admin/super_admin only)
CREATE OR REPLACE FUNCTION public.decide_campaign_approval(_approval_id uuid, _decision text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision %', _decision;
  END IF;
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Not authorized to decide on campaign approvals' USING ERRCODE='42501';
  END IF;
  SELECT status INTO v_status FROM public.campaign_approvals WHERE id = _approval_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Approval already %', v_status;
  END IF;
  UPDATE public.campaign_approvals
    SET status = _decision, approver_user_id = auth.uid(),
        decision_note = _note, decided_at = now()
    WHERE id = _approval_id;
  RETURN jsonb_build_object('id', _approval_id, 'status', _decision);
END;
$function$;

-- 3) Migrate any users on roles being removed to 'user' (none today, but safe)
UPDATE public.user_roles
SET role = 'user'::public.user_role
WHERE role::text IN ('manager','field_sales','inside_sales');

-- 4) Recreate the enum with only the 4 desired values
ALTER TYPE public.user_role RENAME TO user_role_old;
CREATE TYPE public.user_role AS ENUM ('super_admin','admin','sales_head','user');

ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE public.user_role
  USING role::text::public.user_role;

DROP TYPE public.user_role_old;

ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'user'::public.user_role;

-- 5) Recreate the self-assign default policy with the new enum type
CREATE POLICY "Users can self-assign default user role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK ((auth.uid() = user_id) AND (role = 'user'::public.user_role));

-- 6) Drop deprecated permission columns
ALTER TABLE public.page_permissions
  DROP COLUMN IF EXISTS manager_access,
  DROP COLUMN IF EXISTS field_sales_access,
  DROP COLUMN IF EXISTS inside_sales_access;

-- 7) Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.user_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- 8) Promote deepak.dongare@realthingks.com to super_admin (insert if missing)
INSERT INTO public.user_roles (user_id, role, assigned_by, assigned_at)
SELECT id, 'super_admin'::public.user_role, id, now()
FROM auth.users
WHERE lower(email) = 'deepak.dongare@realthingks.com'
ON CONFLICT (user_id) DO UPDATE
  SET role = 'super_admin'::public.user_role,
      assigned_at = now();

-- 9) Tighten RLS on user_roles: only super_admin can write
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;

CREATE POLICY "Super admins can manage all roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- 10) Tighten RLS on page_permissions: only super_admin can write
DROP POLICY IF EXISTS "Admins can insert page permissions" ON public.page_permissions;
DROP POLICY IF EXISTS "Admins can update page permissions" ON public.page_permissions;
DROP POLICY IF EXISTS "Admins can delete page permissions" ON public.page_permissions;

CREATE POLICY "Super admins can insert page permissions"
ON public.page_permissions
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update page permissions"
ON public.page_permissions
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete page permissions"
ON public.page_permissions
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));
