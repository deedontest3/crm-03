
-- 1) Add new Offered stage columns to deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS proposal_version TEXT,
  ADD COLUMN IF NOT EXISTS proposal_sent_date DATE,
  ADD COLUMN IF NOT EXISTS next_follow_up_date DATE;

-- 2) Storage RLS policies for deal-documents bucket
DROP POLICY IF EXISTS "deal_docs_select" ON storage.objects;
CREATE POLICY "deal_docs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents');

DROP POLICY IF EXISTS "deal_docs_insert" ON storage.objects;
CREATE POLICY "deal_docs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-documents');

DROP POLICY IF EXISTS "deal_docs_update" ON storage.objects;
CREATE POLICY "deal_docs_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'deal-documents')
  WITH CHECK (bucket_id = 'deal-documents');

DROP POLICY IF EXISTS "deal_docs_delete" ON storage.objects;
CREATE POLICY "deal_docs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'deal-documents');
