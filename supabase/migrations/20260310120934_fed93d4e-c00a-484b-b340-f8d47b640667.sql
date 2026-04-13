
CREATE TABLE public.email_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL,
  recipient_name text,
  sender_email text NOT NULL,
  subject text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES auth.users(id),
  open_count integer DEFAULT 0,
  unique_opens integer DEFAULT 0,
  is_valid_open boolean DEFAULT true,
  opened_at timestamptz,
  clicked_at timestamptz,
  click_count integer DEFAULT 0,
  contact_id uuid,
  lead_id uuid,
  account_id uuid,
  bounce_type text,
  bounce_reason text,
  bounced_at timestamptz,
  reply_count integer DEFAULT 0,
  replied_at timestamptz,
  last_reply_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.email_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own emails" ON public.email_history
  FOR SELECT TO authenticated USING (sent_by = auth.uid());
CREATE POLICY "Users can insert their own emails" ON public.email_history
  FOR INSERT TO authenticated WITH CHECK (sent_by = auth.uid());
CREATE POLICY "Users can update their own emails" ON public.email_history
  FOR UPDATE TO authenticated USING (sent_by = auth.uid());
CREATE POLICY "Service role can insert emails" ON public.email_history
  FOR INSERT TO service_role WITH CHECK (true);
