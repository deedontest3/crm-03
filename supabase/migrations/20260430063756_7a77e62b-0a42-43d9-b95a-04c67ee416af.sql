
-- B5: admin-managed bot IP prefixes (replaces hard-coded list)
CREATE TABLE IF NOT EXISTS public.email_bot_ip_ranges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr        text NOT NULL UNIQUE,
  label       text,
  is_enabled  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

ALTER TABLE public.email_bot_ip_ranges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage bot ip ranges" ON public.email_bot_ip_ranges;
CREATE POLICY "Admins manage bot ip ranges"
  ON public.email_bot_ip_ranges
  FOR ALL TO authenticated
  USING (is_user_admin())
  WITH CHECK (is_user_admin());

DROP POLICY IF EXISTS "Authenticated read bot ip ranges" ON public.email_bot_ip_ranges;
CREATE POLICY "Authenticated read bot ip ranges"
  ON public.email_bot_ip_ranges
  FOR SELECT TO authenticated
  USING (true);

-- B7: rolling bounce rate over last N outbound emails
CREATE OR REPLACE FUNCTION public.recent_bounce_rate(_campaign_id uuid, _last_n integer DEFAULT 100)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_n AS (
    SELECT
      (cc.email_status = 'Bounced' OR cc.bounced_at IS NOT NULL OR cc.bounce_reason IS NOT NULL)::int AS is_bounce
    FROM public.campaign_communications cc
    WHERE cc.campaign_id = _campaign_id
      AND cc.communication_type = 'Email'
      AND cc.sent_via IN ('azure','manual','sequence_runner','follow_up_automation')
    ORDER BY cc.communication_date DESC
    LIMIT _last_n
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN 0::numeric
              ELSE ROUND(SUM(is_bounce)::numeric / COUNT(*)::numeric, 4)
         END
    FROM last_n;
$$;

GRANT EXECUTE ON FUNCTION public.recent_bounce_rate(uuid, integer) TO authenticated, service_role;
