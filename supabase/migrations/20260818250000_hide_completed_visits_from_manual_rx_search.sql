-- "Enter Doctor's Prescription" (OP mode) picks a patient to open the real
-- consultation form for -- so a visit whose consultation is already
-- digitally completed has nothing left to do here (whoever completed it,
-- doctor or pharmacy, already went through that same form). It used to show
-- anyway with an "already entered digitally" label; simpler and more useful
-- to just not list it, since there is never a reason to pick it.
begin;

-- Dropping the has_digital_consultation output column narrows the return
-- row shape; CREATE OR REPLACE cannot do that, only DROP + CREATE can.
drop function if exists public.list_today_op_visits_for_pharmacy(text, integer);

create function public.list_today_op_visits_for_pharmacy(p_query text default null, p_limit integer default 50)
returns table(
  visit_id uuid, patient_id uuid, patient_name text, patient_phone text, patient_uhid text,
  token_number integer, status text, doctor_name text, fee_paise bigint
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text; v_uhid_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  v_uhid_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select v.id, p.id, p.name, p.phone_normalized, p.uhid, v.token_number, v.status::text, d.display_name, v.fee_paise
  from public.visits v
  join public.patients p on p.id=v.patient_id
  join public.doctors d on d.id=v.doctor_id
  where v.visit_date = current_date
    and v.status <> 'cancelled'
    and not exists(select 1 from public.consultations c where c.visit_id=v.id and c.status='completed')
    and (
      v_query is null
      or p.name ilike '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
      or lower(p.uhid) like v_uhid_query||'%'
    )
  order by v.token_number
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_today_op_visits_for_pharmacy(text,integer) from public, anon;
grant execute on function public.list_today_op_visits_for_pharmacy(text,integer) to authenticated, service_role;

commit;
