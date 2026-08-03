ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS is_compressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_mime text;