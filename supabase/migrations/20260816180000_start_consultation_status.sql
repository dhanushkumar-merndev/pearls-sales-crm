-- A visit only moved to 'in_consultation' when the doctor saved a DRAFT. A
-- doctor who opens the patient, examines them and completes in one go went
-- straight from waiting/ready to completed, so reception and the OP desk could
-- never tell who was actually inside the consulting room -- the patient still
-- read as "Waiting" while they were being seen.
--
-- This marks the visit the moment the consulting doctor opens it. It is a
-- one-way step out of the pre-consultation states only: a completed or
-- cancelled visit is never reopened by viewing it, and re-opening an already
-- in-progress visit changes nothing.
begin;

create or replace function public.start_visit_consultation(p_visit_id uuid)
returns public.visit_status
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_doctor uuid;
  v_status public.visit_status;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role is null or v_role not in ('admin','doctor') then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select status into v_status from public.visits where id = p_visit_id;
  if v_status is null then
    raise exception 'visit not found' using errcode='42704';
  end if;

  -- A doctor may only start the consultation for their own patient.
  if v_role = 'doctor' and not exists(
    select 1 from public.visits where id = p_visit_id and doctor_id = v_doctor
  ) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if v_status in ('waiting','vitals_pending','ready') then
    update public.visits set status = 'in_consultation' where id = p_visit_id;
    insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'CONSULTATION_STARTED', 'visit', p_visit_id);
    return 'in_consultation'::public.visit_status;
  end if;

  return v_status;
end $$;

revoke all on function public.start_visit_consultation(uuid) from public, anon;
grant execute on function public.start_visit_consultation(uuid) to authenticated, service_role;

commit;
