CREATE OR REPLACE FUNCTION public.log_deal_document_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, field_name, new_value, context)
    VALUES (NEW.deal_id, COALESCE(v_actor, NEW.uploaded_by), 'document_added', NEW.kind,
            to_jsonb(NEW.file_name),
            jsonb_build_object('kind', NEW.kind, 'document_id', NEW.id, 'file_name', NEW.file_name));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only log when the parent deal still exists. During a cascade delete of the
    -- deal itself the deal row is already gone, so inserting here would violate
    -- the deal_activity_log_deal_id_fkey foreign key.
    IF EXISTS (SELECT 1 FROM public.deals d WHERE d.id = OLD.deal_id) THEN
      INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, field_name, old_value, context)
      VALUES (OLD.deal_id, v_actor, 'document_removed', OLD.kind,
              to_jsonb(OLD.file_name),
              jsonb_build_object('kind', OLD.kind, 'document_id', OLD.id, 'file_name', OLD.file_name));
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_deal_document_changes() FROM PUBLIC, anon, authenticated;