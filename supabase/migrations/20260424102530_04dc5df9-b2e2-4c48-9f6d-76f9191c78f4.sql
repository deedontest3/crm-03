-- B4: Prevent duplicate audience rows
ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_campaign_contact_unique
  UNIQUE (campaign_id, contact_id);

ALTER TABLE public.campaign_accounts
  ADD CONSTRAINT campaign_accounts_campaign_account_unique
  UNIQUE (campaign_id, account_id);

-- Safety flag for the follow-up dispatcher (off by default)
INSERT INTO public.campaign_settings (setting_key, setting_value)
VALUES ('follow_ups_enabled', 'false')
ON CONFLICT DO NOTHING;

-- B2: Helper to promote a contact's campaign stage when a reply arrives.
-- Only advances forward; never demotes a Qualified/Converted contact.
CREATE OR REPLACE FUNCTION public.promote_contact_on_reply(
  _campaign_id uuid,
  _contact_id uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.campaign_contacts
  SET stage = 'Responded'
  WHERE campaign_id = _campaign_id
    AND contact_id = _contact_id
    AND stage IN ('Not Contacted', 'Email Sent', 'Phone Contacted', 'LinkedIn Contacted');
$$;