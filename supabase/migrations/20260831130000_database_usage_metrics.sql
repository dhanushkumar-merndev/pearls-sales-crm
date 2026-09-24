-- Admin Settings shows PostgreSQL usage separately from object storage.
-- pg_database_size includes tables, indexes, TOAST data, and database metadata.
begin;

create or replace function public.database_usage_bytes()
returns bigint
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() is null or public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  return pg_database_size(current_database())::bigint;
end $$;

revoke all on function public.database_usage_bytes() from public;
grant execute on function public.database_usage_bytes() to authenticated;

commit;
