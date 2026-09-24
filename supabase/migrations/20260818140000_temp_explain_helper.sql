-- Temporary, admin-only diagnostic to verify index usage empirically before
-- shipping the query-optimization pass. Removed by the migration immediately
-- after this one once confirmed.
begin;
create or replace function public.debug_explain(p_sql text)
returns setof text
language plpgsql security definer set search_path='' as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query execute 'explain (analyze, buffers, format text) ' || p_sql;
end $$;
revoke all on function public.debug_explain(text) from public, anon;
grant execute on function public.debug_explain(text) to authenticated, service_role;
commit;
