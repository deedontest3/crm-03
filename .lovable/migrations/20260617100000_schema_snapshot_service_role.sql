-- Fix get_schema_snapshot so the service role can call it from edge functions.
-- Previously the RPC required auth.uid() to have an admin role, which is null
-- when invoked with the service-role key — making diff-backup run without
-- column types and report massive false-positive row updates.

create or replace function public.get_schema_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
  caller_role text := current_setting('request.jwt.claim.role', true);
begin
  -- Allow service_role (edge functions) unconditionally. Otherwise require admin.
  if coalesce(caller_role, '') <> 'service_role' then
    if auth.uid() is null
       or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
      raise exception 'Admin access required';
    end if;
  end if;

  select jsonb_build_object(
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name', c.table_name,
        'column_name', c.column_name,
        'data_type', c.data_type,
        'udt_name', c.udt_name,
        'is_nullable', c.is_nullable,
        'is_generated', c.is_generated,
        'column_default', c.column_default,
        'ordinal_position', c.ordinal_position
      ) order by c.table_name, c.ordinal_position)
      from information_schema.columns c
      where c.table_schema = 'public'
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name', tc.table_name,
        'constraint_name', tc.constraint_name,
        'constraint_type', tc.constraint_type
      ))
      from information_schema.table_constraints tc
      where tc.table_schema = 'public'
    ), '[]'::jsonb),
    'foreign_keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name', tc.table_name,
        'column_name', kcu.column_name,
        'foreign_table_schema', ccu.table_schema,
        'foreign_table_name', ccu.table_name,
        'foreign_column_name', ccu.column_name
      ))
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
    ), '[]'::jsonb),
    'enums', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'values', values))
      from (
        select t.typname as name,
               array_agg(e.enumlabel order by e.enumsortorder) as values
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        group by t.typname
      ) enums
    ), '[]'::jsonb),
    'generated_at', now()
  ) into result;

  return result;
end$$;

revoke all on function public.get_schema_snapshot() from public;
grant execute on function public.get_schema_snapshot() to authenticated, service_role;
