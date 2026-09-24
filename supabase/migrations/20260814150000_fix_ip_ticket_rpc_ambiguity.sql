begin;

create or replace function public.create_ip_ticket(
  p_patient_id uuid, p_doctor_id uuid, p_source_visit_id uuid, p_room text, p_bed text,
  p_reason text, p_deposit_paise bigint, p_payment_mode public.payment_mode,
  p_is_emergency boolean, p_idempotency_key uuid, p_room_bed_id uuid default null
)
returns table(ticket_id uuid, ticket_number text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_role public.app_role; v_doctor uuid; v_id uuid; v_number text; v_room text; v_bed text;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role not in ('admin','ip','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
  if v_role='doctor' and (
    p_source_visit_id is null or v_doctor is distinct from p_doctor_id or not exists(
      select 1 from public.visits visit
      where visit.id=p_source_visit_id and visit.patient_id=p_patient_id and visit.doctor_id=v_doctor
    )
  ) then raise exception 'doctor may only convert their own OP visit'; end if;

  select ticket.id,ticket.ticket_number into v_id,v_number
  from public.ip_tickets ticket where ticket.idempotency_key=p_idempotency_key;
  if v_id is not null then return query select v_id,v_number; return; end if;
  if p_deposit_paise<0 then raise exception 'invalid deposit'; end if;
  if not p_is_emergency and p_patient_id is null then raise exception 'patient is required'; end if;

  if p_room_bed_id is not null then
    select room.room_number,room.bed_number into v_room,v_bed
    from public.room_beds room where room.id=p_room_bed_id and room.active for update;
    if not found then raise exception 'room/bed is unavailable'; end if;
    if exists(
      select 1 from public.ip_tickets ticket
      where ticket.room_bed_id=p_room_bed_id and ticket.status in ('admitted','discharge_pending')
    ) then raise exception 'room/bed is occupied'; end if;
  else
    v_room:=p_room; v_bed:=p_bed;
  end if;

  v_number := 'IP-'||to_char((now() at time zone 'Asia/Kolkata'),'YYYY')||'-'||lpad(nextval('public.ip_ticket_sequence')::text,6,'0');
  insert into public.ip_tickets(ticket_number,patient_id,doctor_id,source_visit_id,room,bed,room_bed_id,admission_reason,is_emergency,patient_linked_at,patient_linked_by,idempotency_key)
  values(v_number,p_patient_id,p_doctor_id,p_source_visit_id,v_room,v_bed,p_room_bed_id,p_reason,p_is_emergency,case when p_patient_id is not null then now() end,case when p_patient_id is not null then auth.uid() end,p_idempotency_key)
  returning ip_tickets.id into v_id;
  if p_deposit_paise>0 then
    insert into public.ip_payments(ip_ticket_id,amount_paise,mode,idempotency_key)
    values(v_id,p_deposit_paise,p_payment_mode,p_idempotency_key);
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when v_role='doctor' then 'OP_CONVERTED_TO_IP' when p_patient_id is null then 'IP_EMERGENCY_ADMITTED' else 'IP_ADMITTED' end,'ip_ticket',v_id,jsonb_build_object('room_bed_id',p_room_bed_id,'source_visit_id',p_source_visit_id));
  return query select v_id,v_number;
exception when unique_violation then
  raise exception 'room/bed is occupied';
end $$;

revoke all on function public.create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,public.payment_mode,boolean,uuid,uuid) from public;
grant execute on function public.create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,public.payment_mode,boolean,uuid,uuid) to authenticated;

commit;
