-- Async job tracking for database cleanup scans
create table if not exists public.cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  modules text[] not null default '{}',
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.cleanup_jobs to authenticated;
grant all on public.cleanup_jobs to service_role;

alter table public.cleanup_jobs enable row level security;

drop policy if exists "owner or admin can read cleanup jobs" on public.cleanup_jobs;
create policy "owner or admin can read cleanup jobs"
  on public.cleanup_jobs for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create index if not exists cleanup_jobs_user_created_idx on public.cleanup_jobs(user_id, created_at desc);
create index if not exists cleanup_jobs_status_idx on public.cleanup_jobs(status);
