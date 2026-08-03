
-- =========================================================
-- 1) New columns on deals
-- =========================================================
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS previous_stage text,
  ADD COLUMN IF NOT EXISTS auto_resurface_from_hold boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_close_slip_notified_at timestamptz;

-- =========================================================
-- 2) deal_documents
-- =========================================================
CREATE TABLE IF NOT EXISTS public.deal_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('rfq','proposal','signed_contract','po','other')),
  file_path   text NOT NULL,
  file_name   text NOT NULL,
  mime_type   text,
  size_bytes  bigint,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_documents_deal ON public.deal_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_documents_kind ON public.deal_documents(deal_id, kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_documents TO authenticated;
GRANT ALL ON public.deal_documents TO service_role;

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dd_select ON public.deal_documents;
CREATE POLICY dd_select ON public.deal_documents FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_documents.deal_id));

DROP POLICY IF EXISTS dd_insert ON public.deal_documents;
CREATE POLICY dd_insert ON public.deal_documents FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_documents.deal_id));

DROP POLICY IF EXISTS dd_update ON public.deal_documents;
CREATE POLICY dd_update ON public.deal_documents FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_documents.deal_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_documents.deal_id));

DROP POLICY IF EXISTS dd_delete ON public.deal_documents;
CREATE POLICY dd_delete ON public.deal_documents FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_documents.deal_id));

-- =========================================================
-- 3) deal_activity_log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.deal_activity_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  actor_id   uuid,
  event_type text NOT NULL CHECK (event_type IN
    ('created','deleted','field_change','stage_change','document_added','document_removed')),
  field_name text,
  old_value  jsonb,
  new_value  jsonb,
  context    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dal_deal_created ON public.deal_activity_log(deal_id, created_at DESC);

GRANT SELECT, INSERT ON public.deal_activity_log TO authenticated;
GRANT ALL ON public.deal_activity_log TO service_role;

ALTER TABLE public.deal_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dal_select ON public.deal_activity_log;
CREATE POLICY dal_select ON public.deal_activity_log FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_activity_log.deal_id));

DROP POLICY IF EXISTS dal_insert ON public.deal_activity_log;
CREATE POLICY dal_insert ON public.deal_activity_log FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_activity_log.deal_id));

-- =========================================================
-- 4) Trigger: log deal field + stage changes
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_deal_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_fields text[] := ARRAY[
    'deal_name','project_name','customer_name','lead_name','lead_owner','region','priority',
    'total_contract_value','final_tcv','currency_type','probability',
    'expected_closing_date','signed_contract_date','implementation_start_date','end_date',
    'start_date','rfq_received_date','proposal_due_date','expected_signing_date','revise_date',
    'po_status','po_number','handoff_status','won_reason','lost_reason','drop_reason',
    'hold_reason','competition','competitors','customer_need','customer_challenges',
    'business_value','decision_maker_level','current_status','closing','rfq_status',
    'opportunity_summary','opportunity_description','customer_objection','bu',
    'project_duration','total_revenue','is_recurring','budget','internal_comment'
  ];
  f text;
  old_v jsonb;
  new_v jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, new_value, context)
    VALUES (NEW.id, v_actor, 'created', to_jsonb(NEW.stage), jsonb_build_object('stage', NEW.stage));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, old_value)
    VALUES (OLD.id, v_actor, 'deleted', to_jsonb(OLD.stage));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Stage transition
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, field_name, old_value, new_value, context)
      VALUES (NEW.id, v_actor, 'stage_change', 'stage',
              to_jsonb(OLD.stage), to_jsonb(NEW.stage),
              jsonb_build_object('from_stage', OLD.stage, 'to_stage', NEW.stage));
      -- Remember previous stage on entering Hold
      IF NEW.stage = 'Hold' AND OLD.stage <> 'Hold' THEN
        NEW.previous_stage := OLD.stage;
      END IF;
    END IF;

    -- Field-level changes
    FOREACH f IN ARRAY v_fields LOOP
      EXECUTE format('SELECT to_jsonb($1.%I), to_jsonb($2.%I)', f, f)
        INTO old_v, new_v USING OLD, NEW;
      IF old_v IS DISTINCT FROM new_v THEN
        INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, field_name, old_value, new_value)
        VALUES (NEW.id, v_actor, 'field_change', f, old_v, new_v);
      END IF;
    END LOOP;

    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_deal_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_deal_changes_ins ON public.deals;
DROP TRIGGER IF EXISTS trg_log_deal_changes_upd ON public.deals;
DROP TRIGGER IF EXISTS trg_log_deal_changes_del ON public.deals;

CREATE TRIGGER trg_log_deal_changes_ins
  AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_changes();

-- BEFORE update so previous_stage assignment persists
CREATE TRIGGER trg_log_deal_changes_upd
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_changes();

CREATE TRIGGER trg_log_deal_changes_del
  AFTER DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_changes();

-- =========================================================
-- 5) Trigger: log document add/remove
-- =========================================================
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
    INSERT INTO public.deal_activity_log(deal_id, actor_id, event_type, field_name, old_value, context)
    VALUES (OLD.deal_id, v_actor, 'document_removed', OLD.kind,
            to_jsonb(OLD.file_name),
            jsonb_build_object('kind', OLD.kind, 'document_id', OLD.id, 'file_name', OLD.file_name));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_deal_document_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_deal_doc_ins ON public.deal_documents;
DROP TRIGGER IF EXISTS trg_log_deal_doc_del ON public.deal_documents;
CREATE TRIGGER trg_log_deal_doc_ins AFTER INSERT ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_document_changes();
CREATE TRIGGER trg_log_deal_doc_del AFTER DELETE ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_document_changes();

-- updated_at on deal_documents
CREATE OR REPLACE FUNCTION public.deal_documents_touch_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_deal_documents_touch ON public.deal_documents;
CREATE TRIGGER trg_deal_documents_touch BEFORE UPDATE ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.deal_documents_touch_updated();

-- =========================================================
-- 6) Tighten validate_deal_dates (P0.2 + P0.3 server mirror)
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_deal_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
BEGIN
  -- Signed contract date in the future is suspicious but allowed for forward-signed contracts.
  -- (kept relaxed — was historically blocked)

  -- Date ordering (only when both sides present)
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL
     AND NEW.start_date > NEW.end_date THEN
    RAISE EXCEPTION 'Project End Date must be on or after Project Start Date';
  END IF;

  IF NEW.signed_contract_date IS NOT NULL AND NEW.implementation_start_date IS NOT NULL
     AND NEW.signed_contract_date > NEW.implementation_start_date THEN
    RAISE EXCEPTION 'Implementation Start Date must be on or after Signed Contract Date';
  END IF;

  IF NEW.implementation_start_date IS NOT NULL AND NEW.end_date IS NOT NULL
     AND NEW.implementation_start_date > NEW.end_date THEN
    RAISE EXCEPTION 'End Date must be on or after Implementation Start Date';
  END IF;

  IF NEW.rfq_received_date IS NOT NULL AND NEW.proposal_due_date IS NOT NULL
     AND NEW.proposal_due_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Submission Date must be on or after RFQ Received Date';
  END IF;

  IF NEW.expected_closing_date IS NOT NULL AND NEW.proposal_due_date IS NOT NULL
     AND NEW.expected_closing_date < NEW.proposal_due_date THEN
    RAISE EXCEPTION 'Target Closure Date must be on or after Submission Date';
  END IF;

  IF NEW.stage = 'Verbal Approval'
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.expected_signing_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.expected_signing_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Expected PO Signing Date';
  END IF;

  IF NEW.stage = 'Won'
     AND NEW.signed_contract_date IS NOT NULL AND NEW.rfq_received_date IS NOT NULL
     AND NEW.signed_contract_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Signed Contract Date must be on or after RFQ Received Date';
  END IF;

  -- P0.2 conditional: competition=Yes ⇒ competitors required
  IF NEW.stage IN ('Negotiation','Verbal Approval','Won')
     AND COALESCE(NEW.competition,'') = 'Yes'
     AND (NEW.competitors IS NULL OR length(btrim(NEW.competitors)) = 0) THEN
    RAISE EXCEPTION 'Competitors are required when competition is Yes';
  END IF;

  RETURN NEW;
END;
$$;
