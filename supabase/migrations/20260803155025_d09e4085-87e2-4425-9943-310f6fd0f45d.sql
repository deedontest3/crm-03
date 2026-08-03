CREATE OR REPLACE FUNCTION public.archive_deals(p_ids uuid[], p_reason text DEFAULT NULL)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_is_admin := public.is_user_admin(v_uid);

  RETURN QUERY
  UPDATE public.deals d
     SET archived_at = now(),
         archived_by = v_uid,
         archive_reason = COALESCE(p_reason, d.archive_reason),
         modified_at = now(),
         modified_by = v_uid
   WHERE d.id = ANY(p_ids)
     AND d.archived_at IS NULL
     AND (v_is_admin OR d.created_by = v_uid)
  RETURNING d.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_deals(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_deals(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_deals(uuid[], text) TO service_role;