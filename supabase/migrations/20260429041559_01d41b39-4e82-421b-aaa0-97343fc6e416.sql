INSERT INTO public.campaign_settings (setting_key, setting_value)
VALUES
  ('cross_campaign_hourly_limit', '20'),
  ('cross_campaign_daily_limit', '50')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;