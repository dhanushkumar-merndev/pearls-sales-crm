-- A consultation draft may override the doctor's configured fee. The visit
-- page cannot select visits.fee_paise directly (financial columns are revoked
-- from clinical roles), so it used to repopulate the master fee every time the
-- draft was reopened. Expose only the one editable amount, only while the
-- caller is allowed to enter that visit's consultation.
begin;

create or replace function public.get_editable_consultation_fee(p_visit_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_fee bigint;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'doctor', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select v.fee_paise
    into v_fee
    from public.visits v
   where v.id = p_visit_id
     and v.status not in ('completed', 'cancelled')
     and (
       v_role in ('admin', 'pharmacy')
       or (v_role = 'doctor' and v.doctor_id = public.current_doctor_id())
     )
     and not exists (
       select 1
         from public.consultations c
        where c.visit_id = v.id
          and c.status = 'completed'
     );

  if not found then
    raise exception 'visit unavailable' using errcode = '42501';
  end if;

  return v_fee;
end;
$$;

revoke all on function public.get_editable_consultation_fee(uuid) from public, anon;
grant execute on function public.get_editable_consultation_fee(uuid) to authenticated, service_role;

commit;
