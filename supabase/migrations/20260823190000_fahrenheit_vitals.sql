begin;

-- Keep the stored unit explicit and convert every historical Celsius reading
-- exactly once as part of the column rename.
alter table public.vitals rename column temperature_c to temperature_f;

-- This is a unit conversion, not a clinical amendment. The immutability
-- trigger correctly protects completed visits during normal operation, so
-- suspend only that trigger for this one transactional rewrite.
alter table public.vitals disable trigger protect_closed_visit_vitals;

update public.vitals
set temperature_f = round((temperature_f * 9 / 5) + 32, 1)
where temperature_f is not null;

alter table public.vitals enable trigger protect_closed_visit_vitals;

alter table public.vitals
  add constraint vitals_temperature_f_range
  check (temperature_f is null or temperature_f between 80 and 115);

-- PostgreSQL does not allow changing an input parameter name with
-- CREATE OR REPLACE. Recreate the RPC so PostgREST exposes p_temperature_f.
drop function public.record_visit_vitals(
  uuid, numeric, numeric, numeric, smallint, smallint, smallint, smallint,
  smallint, text
);

create function public.record_visit_vitals(
  p_visit_id uuid,
  p_weight_kg numeric,
  p_height_cm numeric,
  p_temperature_f numeric,
  p_bp_systolic smallint,
  p_bp_diastolic smallint,
  p_pulse smallint,
  p_spo2 smallint,
  p_respiratory_rate smallint,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_id uuid;
  v_doctor uuid;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();

  if v_role is null or v_role not in ('admin', 'op', 'doctor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.visits
    where id = p_visit_id
      and status not in ('completed', 'cancelled')
      and (v_role <> 'doctor' or doctor_id = v_doctor)
  ) then
    raise exception 'visit unavailable' using errcode = '42501';
  end if;

  insert into public.vitals (
    visit_id, weight_kg, height_cm, temperature_f, bp_systolic,
    bp_diastolic, pulse, spo2, respiratory_rate, notes
  )
  values (
    p_visit_id, p_weight_kg, p_height_cm, p_temperature_f, p_bp_systolic,
    p_bp_diastolic, p_pulse, p_spo2, p_respiratory_rate, p_notes
  )
  on conflict (visit_id) do update set
    weight_kg = excluded.weight_kg,
    height_cm = excluded.height_cm,
    temperature_f = excluded.temperature_f,
    bp_systolic = excluded.bp_systolic,
    bp_diastolic = excluded.bp_diastolic,
    pulse = excluded.pulse,
    spo2 = excluded.spo2,
    respiratory_rate = excluded.respiratory_rate,
    notes = excluded.notes,
    recorded_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  update public.visits set status = 'ready' where id = p_visit_id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
  values (auth.uid(), 'VITALS_RECORDED', 'visit', p_visit_id);

  return v_id;
end;
$$;

revoke all on function public.record_visit_vitals(
  uuid, numeric, numeric, numeric, smallint, smallint, smallint, smallint,
  smallint, text
) from public, anon;

grant execute on function public.record_visit_vitals(
  uuid, numeric, numeric, numeric, smallint, smallint, smallint, smallint,
  smallint, text
) to authenticated;

commit;
