-- 1. Drop old CHECK constraint first
ALTER TABLE public.action_items DROP CONSTRAINT action_items_module_type_check;

-- 2. Migrate existing 'leads' records to 'deals'
UPDATE public.action_items SET module_type = 'deals' WHERE module_type = 'leads';

-- 3. Add new CHECK constraint with 'accounts' instead of 'leads'
ALTER TABLE public.action_items ADD CONSTRAINT action_items_module_type_check 
  CHECK (module_type = ANY (ARRAY['deals'::text, 'accounts'::text, 'contacts'::text]));

-- 4. Drop and recreate UPDATE policy with explicit WITH CHECK for authenticated
DROP POLICY IF EXISTS "Users can update their own action items or admins can update al" ON public.action_items;
CREATE POLICY "Users can update their own action items or admins can update all"
  ON public.action_items FOR UPDATE TO authenticated
  USING (
    is_user_admin() OR (created_by = auth.uid()) OR (assigned_to = auth.uid())
  )
  WITH CHECK (
    is_user_admin() OR (created_by = auth.uid()) OR (assigned_to = auth.uid())
  );

-- 5. Fix SELECT policy to target authenticated
DROP POLICY IF EXISTS "Authenticated users can view all action items" ON public.action_items;
CREATE POLICY "Authenticated users can view all action items"
  ON public.action_items FOR SELECT TO authenticated
  USING (true);

-- 6. Fix INSERT policy to target authenticated
DROP POLICY IF EXISTS "Users can insert action items" ON public.action_items;
CREATE POLICY "Users can insert action items"
  ON public.action_items FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- 7. Fix DELETE policy to target authenticated
DROP POLICY IF EXISTS "Users can delete their own action items or admins can delete al" ON public.action_items;
CREATE POLICY "Users can delete their own action items or admins can delete all"
  ON public.action_items FOR DELETE TO authenticated
  USING (is_user_admin() OR (created_by = auth.uid()));

-- 8. Fix is_user_admin to include SET search_path
CREATE OR REPLACE FUNCTION public.is_user_admin(user_id uuid DEFAULT auth.uid())
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT get_user_role(user_id) = 'admin';
$function$;