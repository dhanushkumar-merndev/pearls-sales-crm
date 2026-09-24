begin;

alter table public.ip_tickets
  alter column patient_id drop not null,
  add column is_emergency boolean not null default false,
  add column patient_linked_at timestamptz,
  add column patient_linked_by uuid references public.profiles(id) on delete restrict,
  add constraint ip_ticket_patient_required_unless_emergency
    check (is_emergency or patient_id is not null);

drop function if exists public.create_ip_ticket(
  uuid, uuid, uuid, text, text, text, bigint, public.payment_mode, uuid
);

create function public.create_ip_ticket(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_source_visit_id uuid,
  p_room text,
  p_bed text,
  p_reason text,
  p_deposit_paise bigint,
  p_payment_mode public.payment_mode,
  p_is_emergency boolean,
  p_idempotency_key uuid
)
returns table(ticket_id uuid, ticket_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_id uuid;
  v_number text;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, ip_tickets.ticket_number
    into v_id, v_number
  from public.ip_tickets
  where idempotency_key = p_idempotency_key;
  if v_id is not null then
    return query select v_id, v_number;
    return;
  end if;

  if p_deposit_paise < 0 then
    raise exception 'invalid deposit';
  end if;
  if not p_is_emergency and p_patient_id is null then
    raise exception 'patient is required for a standard admission';
  end if;
  if p_patient_id is not null and not exists (
    select 1 from public.patients where id = p_patient_id and status = 'active'
  ) then
    raise exception 'active patient not found';
  end if;

  v_number := 'IP-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYYY') || '-' ||
    lpad(nextval('public.ip_ticket_sequence')::text, 6, '0');

  insert into public.ip_tickets(
    ticket_number,
    patient_id,
    doctor_id,
    source_visit_id,
    room,
    bed,
    admission_reason,
    is_emergency,
    patient_linked_at,
    patient_linked_by,
    idempotency_key
  ) values (
    v_number,
    p_patient_id,
    p_doctor_id,
    p_source_visit_id,
    p_room,
    p_bed,
    p_reason,
    p_is_emergency,
    case when p_patient_id is not null then now() else null end,
    case when p_patient_id is not null then auth.uid() else null end,
    p_idempotency_key
  ) returning id into v_id;

  if p_deposit_paise > 0 then
    insert into public.ip_payments(
      ip_ticket_id,
      amount_paise,
      mode,
      idempotency_key
    ) values (
      v_id,
      p_deposit_paise,
      p_payment_mode,
      p_idempotency_key
    );
  end if;

  insert into public.audit_logs(
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    auth.uid(),
    case when p_patient_id is null then 'IP_EMERGENCY_ADMITTED' else 'IP_ADMITTED' end,
    'ip_ticket',
    v_id,
    jsonb_build_object('emergency', p_is_emergency, 'patient_pending', p_patient_id is null)
  );

  return query select v_id, v_number;
end
$$;

create function public.assign_ip_ticket_patient(
  p_ticket_id uuid,
  p_patient_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_existing_patient uuid;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select patient_id
    into v_existing_patient
  from public.ip_tickets
  where id = p_ticket_id
    and status in ('admitted', 'discharge_pending')
  for update;
  if not found then
    raise exception 'active IP ticket not found';
  end if;
  if v_existing_patient is not null then
    raise exception 'patient is already assigned';
  end if;
  if not exists (
    select 1 from public.patients where id = p_patient_id and status = 'active'
  ) then
    raise exception 'active patient not found';
  end if;

  update public.ip_tickets
  set patient_id = p_patient_id,
      patient_linked_at = now(),
      patient_linked_by = auth.uid()
  where id = p_ticket_id;

  insert into public.audit_logs(
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    auth.uid(),
    'IP_PATIENT_ASSIGNED',
    'ip_ticket',
    p_ticket_id,
    jsonb_build_object('patient_id', p_patient_id)
  );

  return p_ticket_id;
end
$$;

create or replace function public.complete_ip_discharge(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_patient uuid;
  v_total bigint;
  v_paid bigint;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select patient_id
    into v_patient
  from public.ip_tickets
  where id = p_ticket_id
    and status = 'discharge_pending'
    and final_diagnosis is not null
  for update;
  if not found then
    raise exception 'clinical discharge summary is required';
  end if;
  if v_patient is null then
    raise exception 'patient assignment is required before discharge';
  end if;

  select coalesce(sum(amount_paise), 0)
    into v_total
  from public.ip_charges
  where ip_ticket_id = p_ticket_id;
  select coalesce(sum(amount_paise), 0)
    into v_paid
  from public.ip_payments
  where ip_ticket_id = p_ticket_id;
  if v_paid < v_total then
    raise exception 'outstanding balance remains';
  end if;

  perform set_config('app.ip_discharge_workflow', 'on', true);
  update public.ip_tickets
  set status = 'discharged', discharge_at = now()
  where id = p_ticket_id;

  insert into public.audit_logs(
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    auth.uid(),
    'IP_DISCHARGED',
    'ip_ticket',
    p_ticket_id,
    jsonb_build_object('total_paise', v_total, 'paid_paise', v_paid)
  );
  return p_ticket_id;
end
$$;

revoke all on function public.create_ip_ticket(
  uuid, uuid, uuid, text, text, text, bigint, public.payment_mode, boolean, uuid
) from public;
revoke all on function public.assign_ip_ticket_patient(uuid, uuid) from public;
grant execute on function public.create_ip_ticket(
  uuid, uuid, uuid, text, text, text, bigint, public.payment_mode, boolean, uuid
) to authenticated;
grant execute on function public.assign_ip_ticket_patient(uuid, uuid) to authenticated;

commit;
