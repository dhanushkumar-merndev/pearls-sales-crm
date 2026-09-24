-- Which IP staff member owns an admission.
--
-- Until now the ward was entirely anonymous: the referral queue was global,
-- any IP staff member could admit anyone, and afterwards nothing recorded who
-- was looking after whom. Reception can now name the staff member when they
-- convert an OP visit, and an IP staff member can take a referral for
-- themselves. Everyone still sees every ticket -- a ward where staff cannot
-- see each other's patients cannot cover a break or a night shift -- with a
-- "My Patients" filter on top.
--
-- Nullable on purpose: an unassigned ticket is a legitimate state (an
-- emergency at 3am that nobody has claimed yet), not a data error.
alter table ip_tickets
  add column if not exists assigned_ip_staff_id uuid references profiles(id);

-- Supports the "My Patients" filter, which only ever asks about live tickets.
create index if not exists ip_tickets_assigned_active_idx
  on ip_tickets (assigned_ip_staff_id, admission_at desc)
  where status in ('admitted', 'discharge_pending');

comment on column ip_tickets.assigned_ip_staff_id is
  'IP staff member responsible for this admission. Null = unclaimed.';

-- Reception admits too now (they own the register; an OP patient the doctor
-- refers is converted at the reception counter).
create or replace function create_ip_ticket(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_source_visit_id uuid,
  p_room text,
  p_bed text,
  p_reason text,
  p_deposit_paise bigint,
  p_payment_mode payment_mode,
  p_is_emergency boolean,
  p_idempotency_key uuid,
  p_room_bed_id uuid default null::uuid,
  p_assigned_ip_staff_id uuid default null::uuid
)
returns table(ticket_id uuid, ticket_number text)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_role public.app_role; v_doctor uuid; v_id uuid; v_number text; v_room text; v_bed text;
  v_assigned uuid;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role is null or v_role not in ('admin','ip','doctor','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if v_role='doctor' and (
    p_source_visit_id is null or v_doctor is distinct from p_doctor_id or not exists(
      select 1 from public.visits visit
      where visit.id=p_source_visit_id and visit.patient_id=p_patient_id and visit.doctor_id=v_doctor
    )
  ) then raise exception 'doctor may only convert their own OP visit'; end if;

  -- Only a real IP staff member can be made responsible for a ward patient;
  -- a mistyped or stale id is dropped rather than silently stored.
  if p_assigned_ip_staff_id is not null then
    select profile.id into v_assigned
    from public.profiles profile
    where profile.id = p_assigned_ip_staff_id and profile.role = 'ip';
    if v_assigned is null then raise exception 'assigned staff member is not IP staff'; end if;
  end if;

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
  insert into public.ip_tickets(ticket_number,patient_id,doctor_id,source_visit_id,room,bed,room_bed_id,admission_reason,is_emergency,patient_linked_at,patient_linked_by,idempotency_key,assigned_ip_staff_id)
  values(v_number,p_patient_id,p_doctor_id,p_source_visit_id,v_room,v_bed,p_room_bed_id,p_reason,p_is_emergency,case when p_patient_id is not null then now() end,case when p_patient_id is not null then auth.uid() end,p_idempotency_key,v_assigned)
  returning ip_tickets.id into v_id;
  if p_deposit_paise>0 then
    insert into public.ip_payments(ip_ticket_id,amount_paise,mode,idempotency_key)
    values(v_id,p_deposit_paise,p_payment_mode,p_idempotency_key);
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when v_role='doctor' then 'OP_CONVERTED_TO_IP' when p_patient_id is null then 'IP_EMERGENCY_ADMITTED' else 'IP_ADMITTED' end,'ip_ticket',v_id,jsonb_build_object('room_bed_id',p_room_bed_id,'source_visit_id',p_source_visit_id,'assigned_ip_staff_id',v_assigned));
  return query select v_id,v_number;
exception when unique_violation then
  raise exception 'room/bed is occupied';
end $function$;

-- Reassignment after the fact: a handover at shift change, or claiming a
-- ticket nobody took. Audited, because "who was looking after this patient"
-- is exactly the question asked after something goes wrong.
create or replace function assign_ip_ticket(p_ticket_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.app_role; v_assigned uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','ip','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_staff_id is not null then
    select profile.id into v_assigned
    from public.profiles profile
    where profile.id = p_staff_id and profile.role = 'ip';
    if v_assigned is null then raise exception 'assigned staff member is not IP staff'; end if;
  end if;
  update public.ip_tickets
  set assigned_ip_staff_id = v_assigned, updated_at = now()
  where id = p_ticket_id and status in ('admitted','discharge_pending');
  if not found then raise exception 'ticket is not open'; end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'IP_TICKET_ASSIGNED','ip_ticket',p_ticket_id,jsonb_build_object('assigned_ip_staff_id',v_assigned));
end $function$;

-- Who is available and how loaded they already are, for the assignment
-- dropdown. One grouped aggregate left joined onto the staff list, not a
-- count per staff member.
create or replace function list_ip_staff_workload()
returns table (id uuid, full_name text, active_patients integer)
language sql
stable
security invoker
set search_path = public
as $$
  with load as (
    select t.assigned_ip_staff_id as staff_id, count(*)::integer as active
    from ip_tickets t
    where t.status in ('admitted','discharge_pending')
      and t.assigned_ip_staff_id is not null
    group by t.assigned_ip_staff_id
  )
  select p.id, p.full_name, coalesce(load.active, 0)
  from profiles p
  left join load on load.staff_id = p.id
  where p.role = 'ip'
  order by p.full_name;
$$;

grant execute on function create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,payment_mode,boolean,uuid,uuid,uuid) to authenticated;
grant execute on function assign_ip_ticket(uuid,uuid) to authenticated;
grant execute on function list_ip_staff_workload() to authenticated;

-- The 11-argument version must go: two overloads of the same name make every
-- PostgREST call ambiguous (PGRST203), so the app could not admit at all.
drop function if exists create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,payment_mode,boolean,uuid,uuid);
