
-- Create campaign_mart table for explicit MART section tracking
CREATE TABLE public.campaign_mart (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  message_done boolean NOT NULL DEFAULT false,
  audience_done boolean NOT NULL DEFAULT false,
  region_done boolean NOT NULL DEFAULT false,
  timing_done boolean NOT NULL DEFAULT false,
  timing_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.campaign_mart ENABLE ROW LEVEL SECURITY;

-- RLS policies using existing campaign access functions
CREATE POLICY "Users can view accessible campaign mart"
  ON public.campaign_mart FOR SELECT TO authenticated
  USING (can_view_campaign(campaign_id));

CREATE POLICY "Users can insert campaign mart for managed campaigns"
  ON public.campaign_mart FOR INSERT TO authenticated
  WITH CHECK (can_manage_campaign(campaign_id));

CREATE POLICY "Users can update accessible campaign mart"
  ON public.campaign_mart FOR UPDATE TO authenticated
  USING (can_manage_campaign(campaign_id))
  WITH CHECK (can_manage_campaign(campaign_id));

CREATE POLICY "Users can delete accessible campaign mart"
  ON public.campaign_mart FOR DELETE TO authenticated
  USING (can_manage_campaign(campaign_id));

-- Auto-update updated_at
CREATE TRIGGER update_campaign_mart_updated_at
  BEFORE UPDATE ON public.campaign_mart
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add linkedin_status column to campaign_contacts if not exists
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS linkedin_status text DEFAULT 'Not Contacted';

-- Add mart_complete column to campaigns for quick list-level querying
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS mart_complete boolean NOT NULL DEFAULT false;
