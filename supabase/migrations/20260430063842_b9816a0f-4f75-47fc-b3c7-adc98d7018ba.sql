
-- Seed bot IPs (idempotent)
INSERT INTO public.email_bot_ip_ranges (cidr, label) VALUES
  ('40.94.',   'Microsoft Safelinks / ATP'),
  ('52.103.',  'Microsoft Safelinks / ATP'),
  ('104.47.',  'Microsoft Safelinks / ATP'),
  ('66.102.',  'Google Image Proxy'),
  ('66.249.',  'Google Bot / Image Proxy')
ON CONFLICT (cidr) DO NOTHING;

-- B1: schedule process-automation-triggers every 15 min (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-automation-triggers-15min') THEN
    PERFORM cron.schedule(
      'process-automation-triggers-15min',
      '*/15 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://nreslricievaamrwfrlx.supabase.co/functions/v1/process-automation-triggers',
          headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
          body := concat('{"time":"', now(), '"}')::jsonb
        );
      $cmd$
    );
  END IF;
END $$;
