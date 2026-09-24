-- Reception assigns the consultant by hand, so the dropdown should show who is
-- already loaded: today's live OP queue per doctor, and how many IP patients
-- they are currently carrying. Without it reception is guessing, and the same
-- doctor collects six tokens while the next one has none.
--
-- One grouped aggregate per table, left joined onto doctors -- NOT a subquery
-- per doctor in the select list, which would re-scan visits once per row.
create or replace function list_doctor_workload()
returns table (
  id uuid,
  display_name text,
  department text,
  op_fee_paise bigint,
  follow_up_fee_paise bigint,
  op_active integer,
  ip_active integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with op_load as (
    select v.doctor_id, count(*)::integer as active
    from visits v
    where v.status in ('waiting', 'in_consultation')
      and v.visit_date = (now() at time zone 'Asia/Kolkata')::date
    group by v.doctor_id
  ),
  ip_load as (
    select t.doctor_id, count(*)::integer as active
    from ip_tickets t
    where t.status in ('admitted', 'discharge_pending')
    group by t.doctor_id
  )
  select
    d.id,
    d.display_name,
    coalesce(dep.name, '—'),
    d.op_fee_paise::bigint,
    d.follow_up_fee_paise::bigint,
    coalesce(op_load.active, 0),
    coalesce(ip_load.active, 0)
  from doctors d
  left join departments dep on dep.id = d.department_id
  left join op_load on op_load.doctor_id = d.id
  left join ip_load on ip_load.doctor_id = d.id
  where d.active
  order by d.display_name;
$$;

grant execute on function list_doctor_workload() to authenticated;
