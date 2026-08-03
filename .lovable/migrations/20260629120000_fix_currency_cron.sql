-- Re-schedule the daily currency refresh cron with proper Authorization
-- header. Without it the edge function rejected every nightly invocation
-- (401), leaving the rates stale.

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-currency-rates-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-currency-rates-daily',
  '15 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://emcppynoiprlowuowgan.supabase.co/functions/v1/refresh-currency-rates',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtY3BweW5vaXBybG93dW93Z2FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTU5MjIsImV4cCI6MjA5Njg5MTkyMn0.EL1ZMVlnTnZVZ0xb_QrAtIrZybznPWPt3Jn3YLf-xh4'
    ),
    body := jsonb_build_object('force', true)
  );
  $$
);
