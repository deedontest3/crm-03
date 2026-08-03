ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS external_url text;

ALTER TABLE public.deal_documents ALTER COLUMN file_path DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.deal_documents'::regclass
      AND conname = 'deal_documents_source_type_check'
  ) THEN
    ALTER TABLE public.deal_documents
      ADD CONSTRAINT deal_documents_source_type_check
      CHECK (source_type IN ('file','link'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.deal_documents'::regclass
      AND conname = 'deal_documents_source_payload_check'
  ) THEN
    ALTER TABLE public.deal_documents
      ADD CONSTRAINT deal_documents_source_payload_check
      CHECK (
        (source_type = 'file' AND file_path IS NOT NULL)
        OR (source_type = 'link' AND external_url IS NOT NULL)
      );
  END IF;
END $$;

DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.deal_documents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%kind%signed_contract%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.deal_documents DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.deal_documents
    ADD CONSTRAINT deal_documents_kind_check
    CHECK (kind IN ('signed_contract','po','rfq_submitted','proposal','other'));
END $$;