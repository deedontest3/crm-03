
REVOKE EXECUTE ON FUNCTION public.update_send_job_schedule(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_send_job_recipients(uuid) FROM PUBLIC, anon;
