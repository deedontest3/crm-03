-- P1.9 — Won closing requirements: po_number column, deal_documents table,
-- private storage bucket, RLS, and an extension of the business-rules trigger.

-- 1. po_number on deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS po_number text;

-- 2. deal_documents table
CREATE TABLE IF NOT EXISTS public.deal_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('signed_contract','po','other')),
  file_path   text NOT NULL,
  file_name   text NOT NULL,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_documents_deal_kind
  ON public.deal_documents (deal_id, kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_documents TO authenticated;
GRANT ALL ON public.deal_documents TO service_role;

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

-- A user may operate on documents belonging to a deal they own; admins see all.
DROP POLICY IF EXISTS "deal_documents_select" ON public.deal_documents;
CREATE POLICY "deal_documents_select"
  ON public.deal_documents FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_documents.deal_id
        AND d.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "deal_documents_insert" ON public.deal_documents;
CREATE POLICY "deal_documents_insert"
  ON public.deal_documents FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.deals d
        WHERE d.id = deal_documents.deal_id
          AND d.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "deal_documents_update" ON public.deal_documents;
CREATE POLICY "deal_documents_update"
  ON public.deal_documents FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_documents.deal_id
        AND d.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "deal_documents_delete" ON public.deal_documents;
CREATE POLICY "deal_documents_delete"
  ON public.deal_documents FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_documents.deal_id
        AND d.created_by = auth.uid()
    )
  );

-- 3. Private storage bucket for deal documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-documents', 'deal-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Object path convention: {deal_id}/{kind}/{filename}
-- Allow CRUD when the user owns the parent deal (or is admin).
DROP POLICY IF EXISTS "deal_documents storage select" ON storage.objects;
CREATE POLICY "deal_documents storage select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.deals d
        WHERE d.id::text = (storage.foldername(name))[1]
          AND d.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "deal_documents storage insert" ON storage.objects;
CREATE POLICY "deal_documents storage insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deal-documents'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.deals d
        WHERE d.id::text = (storage.foldername(name))[1]
          AND d.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "deal_documents storage delete" ON storage.objects;
CREATE POLICY "deal_documents storage delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.deals d
        WHERE d.id::text = (storage.foldername(name))[1]
          AND d.created_by = auth.uid()
      )
    )
  );

-- 4. Extend the deal business-rules trigger for Won closing requirements.
CREATE OR REPLACE FUNCTION public.validate_deal_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today date := CURRENT_DATE;
  open_stages text[] := ARRAY['Lead','Discussions','Qualified','RFQ','Offered','Verbal Approval'];
  competitor_stages text[] := ARRAY['Negotiation','Verbal Approval','Won'];
  has_signed_doc boolean;
BEGIN
  IF NEW.signed_contract_date IS NOT NULL AND NEW.signed_contract_date > today THEN
    RAISE EXCEPTION 'Signed contract date cannot be in the future';
  END IF;

  IF NEW.stage = ANY(competitor_stages)
     AND COALESCE(NEW.competition, '') = 'Yes'
     AND (NEW.competitors IS NULL OR btrim(NEW.competitors) = '') THEN
    RAISE EXCEPTION 'Competitors are required when competition is Yes';
  END IF;

  IF NEW.stage = 'Hold'
     AND NEW.revise_date IS NOT NULL
     AND NEW.revise_date <= today THEN
    RAISE EXCEPTION 'Revise Date must be in the future';
  END IF;

  IF NEW.stage = 'Verbal Approval'
     AND NEW.expected_signing_date IS NOT NULL
     AND COALESCE(NEW.po_status, '') <> 'Received'
     AND NEW.expected_signing_date < today THEN
    RAISE EXCEPTION 'Expected PO Signing Date must be today or later until PO is Received';
  END IF;

  IF NEW.rfq_received_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
     AND NEW.proposal_due_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Submission Date must be on or after RFQ Received Date';
  END IF;

  IF NEW.stage = ANY(open_stages)
     AND NEW.expected_closing_date IS NOT NULL
     AND NEW.expected_closing_date < today THEN
    RAISE EXCEPTION 'Target Closure Date must be today or later for open stages';
  END IF;

  IF NEW.expected_closing_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
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
     AND NEW.signed_contract_date IS NOT NULL
     AND NEW.rfq_received_date IS NOT NULL
     AND NEW.signed_contract_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Signed Contract Date must be on or after RFQ Received Date';
  END IF;

  IF NEW.start_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
     AND NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Project End Date must be on or after Project Start Date';
  END IF;

  IF NEW.signed_contract_date IS NOT NULL
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.signed_contract_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Signed Contract Date';
  END IF;

  -- P1.9 — Won closing requirements (UPDATE-only; row id must already exist)
  IF TG_OP = 'UPDATE' AND NEW.stage = 'Won' THEN
    IF COALESCE(NEW.handoff_status, 'Not Started') = 'Not Started' THEN
      RAISE EXCEPTION 'Handoff Status must be started before marking the deal Won';
    END IF;

    IF COALESCE(NEW.po_status, '') <> 'Not Required'
       AND (NEW.po_number IS NULL OR btrim(NEW.po_number) = '') THEN
      RAISE EXCEPTION 'PO Number is required when a PO is expected';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.deal_documents
      WHERE deal_id = NEW.id AND kind = 'signed_contract'
    ) INTO has_signed_doc;

    IF NOT has_signed_doc THEN
      RAISE EXCEPTION 'A signed contract document must be attached before marking the deal Won';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_deal_business_rules_trigger ON public.deals;
CREATE TRIGGER validate_deal_business_rules_trigger
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_deal_business_rules();
