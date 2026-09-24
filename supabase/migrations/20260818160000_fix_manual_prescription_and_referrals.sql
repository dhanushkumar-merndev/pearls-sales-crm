-- Two real bugs found while dogfooding "Dispense as Per Rx" and the IP
-- admission referral queue.
begin;

-- 1. create_manual_prescription always inserted prescriptions with
--    status='pending' and then tried to insert prescription_items into it.
--    protect_prescription_content() (20260811174000) blocks ANY insert into
--    prescription_items unless the parent prescription is still 'draft' --
--    so every single call failed with "completed prescription content is
--    immutable", the generic fallback the client showed as "The prescription
--    could not be saved." The fix mirrors save_visit_consultation's proven
--    order: insert as 'draft', insert the items while still draft, then flip
--    status once they're in. For IP, an existing pending/partially-dispensed
--    prescription can no longer be appended to for the same reason, so each
--    manual entry now creates its own prescription (ip_ticket_id has no
--    unique constraint, so this was always a valid shape).
create or replace function public.create_manual_prescription(
  p_visit_id uuid default null,
  p_ip_ticket_id uuid default null,
  p_doctor_id uuid default null,
  p_fee_paise bigint default null,
  p_lines jsonb default '[]'::jsonb,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role; v_visit_doctor uuid; v_ticket_doctor uuid; v_doctor uuid;
  v_status public.visit_status; v_ip_status public.ip_status;
  v_consultation uuid; v_prescription uuid; v_line jsonb; v_existing uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
  if (p_visit_id is null) = (p_ip_ticket_id is null) then
    raise exception 'exactly one of visit or ip ticket is required' using errcode='23514';
  end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) < 1 then
    raise exception 'at least one medicine is required' using errcode='23514';
  end if;

  if p_idempotency_key is not null then
    select (metadata->>'prescription_id')::uuid into v_existing
      from public.audit_logs
      where action='MANUAL_PRESCRIPTION_ENTERED' and metadata->>'idempotency_key'=p_idempotency_key::text
      limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;

  if p_visit_id is not null then
    select doctor_id,status into v_visit_doctor,v_status from public.visits where id=p_visit_id for update;
    if not found then raise exception 'visit unavailable' using errcode='42501'; end if;
    if v_status = 'cancelled' then raise exception 'visit is cancelled' using errcode='23514'; end if;
    if exists(select 1 from public.consultations where visit_id=p_visit_id and status='completed') then
      raise exception 'consultation already completed digitally' using errcode='23514';
    end if;
    v_doctor := coalesce(p_doctor_id, v_visit_doctor);

    insert into public.consultations(visit_id,doctor_id,assessment,status,completed_at)
      values(p_visit_id,v_doctor,'Prescribed on paper by the consulting doctor; entered by pharmacy.','completed',now())
    on conflict(visit_id) do update set doctor_id=excluded.doctor_id,status='completed',completed_at=now()
    returning id into v_consultation;

    -- Must start 'draft' -- prescription_items cannot be inserted otherwise.
    insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'draft')
    on conflict(visit_id) do update set doctor_id=excluded.doctor_id,status='draft',updated_at=now()
    returning id into v_prescription;

    if p_fee_paise is not null then
      if p_fee_paise < 0 then raise exception 'fee must not be negative' using errcode='23514'; end if;
      update public.visits set fee_paise=p_fee_paise where id=p_visit_id;
    end if;
  else
    select doctor_id,status into v_ticket_doctor,v_ip_status from public.ip_tickets where id=p_ip_ticket_id for update;
    if not found then raise exception 'ip ticket unavailable' using errcode='42501'; end if;
    if v_ip_status not in ('admitted','discharge_pending') then raise exception 'ip ticket is not active' using errcode='23514'; end if;
    v_doctor := coalesce(p_doctor_id, v_ticket_doctor);

    -- A fresh prescription per manual entry: ip_ticket_id carries no unique
    -- constraint, and an existing pending one can no longer be appended to
    -- (same draft-only insert rule as above).
    insert into public.prescriptions(ip_ticket_id,doctor_id,status) values(p_ip_ticket_id,v_doctor,'draft') returning id into v_prescription;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',
           greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;

  update public.prescriptions set status = case
      when exists(select 1 from public.prescription_items where prescription_id=v_prescription and dispensed_quantity<requested_quantity) then
        'pending'::public.prescription_status
      else 'dispensed'::public.prescription_status
    end
    where id=v_prescription;

  if p_visit_id is not null then
    update public.visits set status='completed' where id=p_visit_id and status not in ('completed','cancelled');
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MANUAL_PRESCRIPTION_ENTERED','prescription',v_prescription,
           jsonb_build_object('idempotency_key',p_idempotency_key::text,'prescription_id',v_prescription,'visit_id',p_visit_id,'ip_ticket_id',p_ip_ticket_id,'doctor_id',v_doctor));

  return v_prescription;
end $$;

revoke all on function public.create_manual_prescription(uuid,uuid,uuid,bigint,jsonb,uuid) from public, anon;
grant execute on function public.create_manual_prescription(uuid,uuid,uuid,bigint,jsonb,uuid) to authenticated, service_role;

-- 2. The admission referral queue only excluded a referral when an IP ticket
--    existed for that EXACT source visit. A patient admitted through a
--    different path (e.g. the plain "New Admission" button, unrelated to any
--    visit) still has an active ticket, but the referral for their original
--    OP visit kept showing "Admit" -- clicking it tried to double-admit an
--    already-admitted patient. Excludes on the patient having any currently
--    active ticket at all, not just one tied to this visit.
create or replace function public.list_admission_referrals(p_limit integer default 50)
returns table(
  consultation_id uuid, visit_id uuid, patient_id uuid, patient_name text, patient_phone text,
  doctor_name text, ward_type text, admission_reason text, assessment text, recommended_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() not in ('admin','ip') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select c.id, c.visit_id, v.patient_id, p.name, p.phone_normalized,
         d.display_name, c.admission_ward_type, c.admission_reason, c.assessment, c.completed_at
  from public.consultations c
  join public.visits v on v.id = c.visit_id
  join public.patients p on p.id = v.patient_id
  join public.doctors d on d.id = c.doctor_id
  where c.admission_recommended
    and c.status = 'completed'
    and not exists (
      select 1 from public.ip_tickets t
      where t.patient_id = v.patient_id and t.status in ('admitted','discharge_pending')
    )
  order by c.completed_at desc
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_admission_referrals(integer) from public;
grant execute on function public.list_admission_referrals(integer) to authenticated;

commit;
