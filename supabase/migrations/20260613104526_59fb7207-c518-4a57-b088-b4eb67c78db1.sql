
-- Tombstone fields on profiles so we can keep historical user references resolvable
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_email text;

CREATE INDEX IF NOT EXISTS idx_profiles_is_deleted ON public.profiles (is_deleted);

-- Helper: is a given profile id soft-deleted?
CREATE OR REPLACE FUNCTION public.is_user_deleted(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_deleted FROM public.profiles WHERE id = _user_id),
    false
  );
$$;

-- Make sure deleted users no longer count as admins
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ur.role::text
      FROM public.user_roles ur
      LEFT JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = p_user_id
        AND COALESCE(p.is_deleted, false) = false
    ),
    'user'
  );
$$;
