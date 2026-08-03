-- Private bucket for admin-uploaded backups to be diffed/restored
insert into storage.buckets (id, name, public)
values ('backup-uploads', 'backup-uploads', false)
on conflict (id) do nothing;

-- Admins can insert files into their own folder
create policy "admins upload own backup uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'backup-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
  );

-- Admins can read their own uploads
create policy "admins read own backup uploads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'backup-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
  );

-- Admins can delete their own uploads
create policy "admins delete own backup uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'backup-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
  );
