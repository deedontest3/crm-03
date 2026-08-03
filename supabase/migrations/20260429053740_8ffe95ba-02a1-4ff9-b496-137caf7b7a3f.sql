-- Disable automatic action item creation when a contact replies on a campaign.
-- Users want to create campaign action items manually only.
DROP TRIGGER IF EXISTS auto_action_item_on_response_trg ON public.campaign_contacts;
DROP FUNCTION IF EXISTS public.auto_action_item_on_response();