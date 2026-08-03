-- Async job tracking for advanced backup diff/restore
create table public.backup_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('diff','restore')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  upload_path text,
  request_input jsonb,
  result jsonb,
  error text,
  progress jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.backup_jobs to authenticated;
grant all on public.backup_jobs to service_role;

alter table public.backup_jobs enable row level security;

create policy "owner or admin can read backup jobs"
  on public.backup_jobs for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create index backup_jobs_user_created_idx on public.backup_jobs(user_id, created_at desc);
create index backup_jobs_status_idx on public.backup_jobs(status);
