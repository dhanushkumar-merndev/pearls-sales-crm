-- list_ip_staff_workload ran as the caller, and reception cannot read other
-- staff rows in `profiles` -- so reception, the role that is meant to name the
-- IP staff member on an admission, got an empty dropdown.
--
-- Security definer with an explicit role check instead. It exposes only what
-- an assignment dropdown needs (id, name, how many ward patients they hold)
-- and only to the roles that assign; it is not a general profiles reader.
create or replace function list_ip_staff_workload()
returns table (id uuid, full_name text, active_patients integer)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','ip','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  with load as (
    select t.assigned_ip_staff_id as staff_id, count(*)::integer as active
    from public.ip_tickets t
    where t.status in ('admitted','discharge_pending')
      and t.assigned_ip_staff_id is not null
    group by t.assigned_ip_staff_id
  )
  select p.id, p.full_name, coalesce(load.active, 0)
  from public.profiles p
  left join load on load.staff_id = p.id
  where p.role = 'ip'
  order by p.full_name;
end $$;

grant execute on function list_ip_staff_workload() to authenticated;
