-- SECURITY FIX -- two independent holes, both found by probing the deployed
-- database with nothing but the public anon key.
--
-- 1. Every SECURITY DEFINER function in public was executable by 'anon'.
--    The migrations revoked EXECUTE from PUBLIC and granted it to
--    'authenticated' one function at a time, and the ones that were missed kept
--    the PostgreSQL default (EXECUTE to PUBLIC, which anon inherits).
--
-- 2. The role guards were written as
--        if v_role not in ('admin','pharmacy') then raise exception 'forbidden'
--    but public.current_app_role() returns NULL when there is no signed-in
--    user, and "NULL not in (...)" evaluates to NULL, not true -- so IF treated
--    it as false and the guard fell through.
--
-- Together these let an unauthenticated caller read pending prescriptions
-- (patient names, phone numbers, medicines), pharmacy stock, outstanding
-- consultation fees, admission referrals with diagnoses, and the hospital
-- dashboard totals. Verified before and after this migration.
--
-- Fix 1 is applied to every function in the schema, so a function added later
-- without an explicit revoke cannot reopen the hole. Fix 2 makes each guard
-- reject a NULL role explicitly, which keeps the functions safe on their own
-- even if the grants are ever loosened again.
begin;

-- Fix 1: no anonymous execution anywhere in the public schema.
do $revoke$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end
$revoke$;

-- Newly created functions must not inherit EXECUTE for PUBLIC either.
alter default privileges in schema public revoke execute on functions from public;

-- Fix 2: NULL-safe role guards. Each function below is re-created from its
-- deployed definition with only the guard condition changed.

-- add_consultant_to_token(uuid,uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.add_consultant_to_token(p_source_visit_id uuid, p_doctor_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS TABLE(visit_id uuid, token_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role; v_source public.visits%rowtype;
  v_department uuid; v_fee bigint; v_visit uuid; v_token integer;
begin
  v_role:=public.current_app_role();
  if v_role is null or v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason required'; end if;

  select id,visits.token_number into v_visit,v_token
  from public.visits where idempotency_key=p_idempotency_key;
  if v_visit is not null then return query select v_visit,v_token; return; end if;

  select * into v_source from public.visits where id=p_source_visit_id for update;
  if not found then raise exception 'visit unavailable'; end if;
  if v_source.visit_date<>(now() at time zone 'Asia/Kolkata')::date
    or v_source.status not in ('waiting','vitals_pending','ready') then
    raise exception 'visit can no longer receive another consultant';
  end if;
  -- Same patient, same day, same doctor is the real duplicate test now that
  -- token numbers are no longer shared between consultants.
  if exists(
    select 1 from public.visits
    where patient_id=v_source.patient_id and visit_date=v_source.visit_date
      and doctor_id=p_doctor_id
  ) then raise exception 'consultant already assigned'; end if;

  select department_id,
    case when v_source.visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
  into v_department,v_fee from public.doctors where id=p_doctor_id and active;
  if not found then raise exception 'consultant unavailable'; end if;

  v_token:=public.next_doctor_token(p_doctor_id,v_source.visit_date);

  insert into public.visits(
    patient_id,doctor_id,department_id,visit_type,visit_date,token_number,
    fee_paise,status,related_previous_visit_id,notes,idempotency_key
  ) values(
    v_source.patient_id,p_doctor_id,v_department,v_source.visit_type,
    v_source.visit_date,v_token,0,v_source.status,
    v_source.related_previous_visit_id,
    concat_ws(E'\n',v_source.notes,'Additional consultant: '||trim(p_reason)),
    p_idempotency_key
  ) returning id into v_visit;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'CONSULTANT_ADDED_TO_TOKEN','visit',v_visit,jsonb_build_object(
    'source_visit_id',p_source_visit_id,'doctor_id',p_doctor_id,
    'token',v_token,'reason',trim(p_reason)
  ));
  return query select v_visit,v_token;
end $function$
;

-- add_ip_progress_note(uuid,text,boolean,uuid)
CREATE OR REPLACE FUNCTION public.add_ip_progress_note(p_ticket_id uuid, p_note text, p_chargeable boolean, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_doctor uuid;v_note uuid;v_fee bigint;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.ip_tickets where id=p_ticket_id and status='admitted' and (v_role='admin' or doctor_id=v_doctor)) then raise exception 'IP ticket unavailable' using errcode='42501';end if;
 select id into v_note from public.ip_progress_notes where idempotency_key=p_idempotency_key;if v_note is not null then return v_note;end if;
 if v_role='admin' and v_doctor is null then select doctor_id into v_doctor from public.ip_tickets where id=p_ticket_id;end if;
 insert into public.ip_progress_notes(ip_ticket_id,doctor_id,note,chargeable,idempotency_key) values(p_ticket_id,v_doctor,p_note,p_chargeable,p_idempotency_key) returning id into v_note;
 if p_chargeable then select ip_visit_fee_paise into v_fee from public.doctors where id=v_doctor;insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key) values(p_ticket_id,'doctor','IP Doctor Visit',1,coalesce(v_fee,0),'ip_progress_note',v_note,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_PROGRESS_NOTE_ADDED','ip_progress_note',v_note);return v_note;
end $function$
;

-- assign_ip_ticket_patient(uuid,uuid)
CREATE OR REPLACE FUNCTION public.assign_ip_ticket_patient(p_ticket_id uuid, p_patient_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_existing_patient uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'ip') then
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
$function$
;

-- bulk_import_medicines(jsonb,text,uuid)
CREATE OR REPLACE FUNCTION public.bulk_import_medicines(p_rows jsonb, p_file_name text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_job uuid;v_row jsonb;v_medicine uuid;v_batch uuid;v_created_medicines integer:=0;v_new_batches integer:=0;v_updated_batches integer:=0;v_row_count integer;
begin
 v_role:=public.current_app_role();if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 v_row_count:=jsonb_array_length(p_rows);if v_row_count<1 or v_row_count>1000 then raise exception 'row count must be between 1 and 1000';end if;
 select id into v_job from public.bulk_import_jobs where idempotency_key=p_idempotency_key;
 if v_job is not null then return (select jsonb_build_object('job_id',id,'row_count',row_count,'success_count',success_count,'created_medicines',coalesce((select (metadata->>'created_medicines')::integer from public.audit_logs where entity_id=id and action='BULK_MEDICINE_IMPORT_COMPLETED' order by created_at desc limit 1),0)) from public.bulk_import_jobs where id=v_job);end if;
 insert into public.bulk_import_jobs(file_name,row_count,status,idempotency_key) values(left(p_file_name,255),v_row_count,'processing',p_idempotency_key) returning id into v_job;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  select id into v_medicine from public.medicine_directory where lower(regexp_replace(trim(brand_name),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'medicine_name'),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(generic_name,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'generic_name','')),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(strength,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'strength','')),'\s+',' ','g')) and lower(regexp_replace(trim(dosage_form),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'dosage_form'),'\s+',' ','g'));
  if v_medicine is null then
   insert into public.medicine_directory(brand_name,generic_name,strength,dosage_form,manufacturer,active,source) values(v_row->>'medicine_name',nullif(v_row->>'generic_name',''),nullif(v_row->>'strength',''),v_row->>'dosage_form',nullif(v_row->>'manufacturer',''),coalesce((v_row->>'active')::boolean,true),'bulk import') returning id into v_medicine;v_created_medicines:=v_created_medicines+1;
  end if;
  select id into v_batch from public.medicine_batches where medicine_id=v_medicine and lower(regexp_replace(trim(batch_number),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'batch_number'),'\s+',' ','g')) for update;
  if v_batch is not null then
   update public.medicine_batches set quantity=quantity+(v_row->>'opening_quantity')::integer,expiry_date=(v_row->>'expiry_date')::date,purchase_price_paise=nullif(v_row->>'purchase_price_paise','')::bigint,selling_price_paise=(v_row->>'selling_price_paise')::bigint,low_stock_threshold=coalesce((v_row->>'low_stock_threshold')::integer,10),active=coalesce((v_row->>'active')::boolean,true),updated_at=now() where id=v_batch;v_updated_batches:=v_updated_batches+1;
  else
   insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active) values(v_medicine,v_row->>'batch_number',(v_row->>'expiry_date')::date,(v_row->>'opening_quantity')::integer,nullif(v_row->>'purchase_price_paise','')::bigint,(v_row->>'selling_price_paise')::bigint,coalesce((v_row->>'low_stock_threshold')::integer,10),coalesce((v_row->>'active')::boolean,true));v_new_batches:=v_new_batches+1;
  end if;
 end loop;
 update public.bulk_import_jobs set success_count=v_row_count,error_count=0,status='ready',completed_at=now() where id=v_job;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'BULK_MEDICINE_IMPORT_COMPLETED','bulk_import_job',v_job,jsonb_build_object('file_name',p_file_name,'row_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches));
 return jsonb_build_object('job_id',v_job,'row_count',v_row_count,'success_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches);
exception when others then
 if v_job is not null then update public.bulk_import_jobs set status='failed',error_count=v_row_count,completed_at=now() where id=v_job;end if;raise;
end $function$
;

-- complete_ip_discharge(uuid)
CREATE OR REPLACE FUNCTION public.complete_ip_discharge(p_ticket_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_patient uuid;
  v_total bigint;
  v_paid bigint;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'ip') then
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
$function$
;

-- create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,payment_mode,boolean,uuid,uuid)
CREATE OR REPLACE FUNCTION public.create_ip_ticket(p_patient_id uuid, p_doctor_id uuid, p_source_visit_id uuid, p_room text, p_bed text, p_reason text, p_deposit_paise bigint, p_payment_mode payment_mode, p_is_emergency boolean, p_idempotency_key uuid, p_room_bed_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ticket_id uuid, ticket_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_role public.app_role; v_doctor uuid; v_id uuid; v_number text; v_room text; v_bed text;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role is null or v_role not in ('admin','ip','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
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
end $function$
;

-- create_multi_consultant_visit(uuid,visit_type,payment_mode,uuid,text,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.create_multi_consultant_visit(p_patient_id uuid, p_visit_type visit_type, p_payment_mode payment_mode, p_previous_visit_id uuid, p_notes text, p_idempotency_key uuid, p_consultants jsonb)
 RETURNS TABLE(visit_id uuid, token_number integer, doctor_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role; v_date date; v_token integer; v_visit uuid; v_first uuid;
  v_item jsonb; v_doctor uuid; v_department uuid; v_fee bigint;
begin
  v_role:=public.current_app_role();
  if v_role is null or v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.visits where idempotency_key=p_idempotency_key) then
    return query
      select v.id, v.token_number, d.display_name
      from public.visits v join public.doctors d on d.id=v.doctor_id
      where v.patient_id=p_patient_id and v.visit_date=(now() at time zone 'Asia/Kolkata')::date
      order by v.created_at;
    return;
  end if;
  if jsonb_typeof(p_consultants)<>'array' or jsonb_array_length(p_consultants)<1 then raise exception 'consultant required'; end if;
  if (select count(*)<>count(distinct value->>'doctor_id') from jsonb_array_elements(p_consultants)) then raise exception 'duplicate consultant'; end if;
  if p_visit_type='follow_up' and not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id) then raise exception 'invalid follow-up'; end if;
  v_date:=(now() at time zone 'Asia/Kolkata')::date;
  for v_item in select value from jsonb_array_elements(p_consultants) loop
    v_doctor:=(v_item->>'doctor_id')::uuid;
    select department_id,case when p_visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
      into v_department,v_fee from public.doctors where id=v_doctor and active;
    if not found then raise exception 'consultant unavailable'; end if;
    -- Each doctor issues from their own series.
    v_token:=public.next_doctor_token(v_doctor,v_date);
    insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
      values(p_patient_id,v_doctor,v_department,p_visit_type,v_date,v_token,0,'waiting',p_previous_visit_id,p_notes,case when v_first is null then p_idempotency_key else gen_random_uuid() end)
      returning id into v_visit;
    if v_first is null then v_first:=v_visit; end if;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MULTI_CONSULTANT_VISIT_CREATED','visit',v_first,jsonb_build_object('consultant_count',jsonb_array_length(p_consultants),'per_doctor_series',true));
  return query
    select v.id, v.token_number, d.display_name
    from public.visits v join public.doctors d on d.id=v.doctor_id
    where v.patient_id=p_patient_id and v.visit_date=v_date
    order by v.created_at;
end $function$
;

-- create_procedure_sale(uuid,uuid,uuid,text,bigint,jsonb,payment_mode,text,uuid)
CREATE OR REPLACE FUNCTION public.create_procedure_sale(p_patient_id uuid, p_visit_id uuid, p_doctor_id uuid, p_procedure_name text, p_procedure_fee_paise bigint, p_lines jsonb, p_payment_mode payment_mode, p_notes text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale_id uuid; v_line jsonb; v_item public.inventory_items%rowtype;
  v_qty integer; v_items_total bigint := 0;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if coalesce(trim(p_procedure_name),'') = '' then
    raise exception 'procedure name required' using errcode='23514';
  end if;
  if p_procedure_fee_paise < 0 then
    raise exception 'invalid procedure fee' using errcode='23514';
  end if;
  -- Retry of the same submission returns the original sale untouched.
  select id into v_sale_id from public.procedure_sales where idempotency_key = p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;

  insert into public.procedure_sales(patient_id,visit_id,doctor_id,procedure_name,procedure_fee_paise,payment_mode,notes,idempotency_key)
    values(p_patient_id,nullif(p_visit_id,'00000000-0000-0000-0000-000000000000'::uuid),p_doctor_id,trim(p_procedure_name),p_procedure_fee_paise,p_payment_mode,nullif(trim(coalesce(p_notes,'')),''),p_idempotency_key)
    returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity' using errcode='23514'; end if;
    -- Row lock: two counters billing the last roll of gauze cannot both win.
    select * into v_item from public.inventory_items
      where id = (v_line->>'inventory_item_id')::uuid and active for update;
    if not found then raise exception 'inventory item unavailable' using errcode='23514'; end if;
    if v_item.quantity < v_qty then
      raise exception 'insufficient inventory stock' using errcode='23514';
    end if;
    update public.inventory_items
      set quantity = quantity - v_qty, updated_at = now()
      where id = v_item.id;
    insert into public.procedure_sale_items(sale_id,inventory_item_id,quantity,unit_price_paise)
      values(v_sale_id,v_item.id,v_qty,v_item.selling_price_paise);
    v_items_total := v_items_total + (v_qty * v_item.selling_price_paise);
  end loop;

  update public.procedure_sales
    set items_total_paise = v_items_total,
        total_paise = v_items_total + p_procedure_fee_paise
    where id = v_sale_id;

  -- An admitted patient's procedure goes onto the IP ticket instead of being
  -- collected separately at the counter.
  insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key)
  select t.id,'treatment',trim(p_procedure_name),1,v_items_total + p_procedure_fee_paise,'procedure_sale',v_sale_id,p_idempotency_key
  from public.ip_tickets t
  where t.patient_id = p_patient_id and t.status in ('admitted','discharge_pending')
  limit 1;

  -- If it landed on an IP ticket the patient settles it at discharge, so the
  -- counter must NOT also collect for it: clearing payment_mode marks this sale
  -- as billed-to-ticket rather than paid-at-counter.
  update public.procedure_sales s
    set ip_ticket_id = c.ip_ticket_id, payment_mode = null
    from public.ip_charges c
    where c.source_id = v_sale_id and c.source_type = 'procedure_sale' and s.id = v_sale_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'PROCEDURE_SALE_CREATED','procedure_sale',v_sale_id,
           jsonb_build_object('total_paise',v_items_total + p_procedure_fee_paise,'items',jsonb_array_length(coalesce(p_lines,'[]'::jsonb))));
  return v_sale_id;
end $function$
;

-- create_visit_with_token(uuid,uuid,visit_type,bigint,bigint,payment_mode,uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.create_visit_with_token(p_patient_id uuid, p_doctor_id uuid, p_visit_type visit_type, p_fee_paise bigint, p_collected_paise bigint, p_payment_mode payment_mode, p_previous_visit_id uuid, p_notes text, p_idempotency_key uuid)
 RETURNS TABLE(visit_id uuid, token_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_date date;v_token integer;v_visit uuid;v_department uuid;
begin
 v_role:=public.current_app_role();
 if v_role is null or v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 select id,visits.token_number into v_visit,v_token from public.visits where idempotency_key=p_idempotency_key;
 if v_visit is not null then return query select v_visit,v_token;return;end if;
 if p_fee_paise<0 or p_collected_paise<0 or p_collected_paise>p_fee_paise then raise exception 'invalid payment';end if;
 if p_visit_type='follow_up' and not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id) then raise exception 'invalid follow-up';end if;
 v_date:=(now() at time zone 'Asia/Kolkata')::date;
 select department_id into v_department from public.doctors where id=p_doctor_id and active;
 if not found then raise exception 'doctor unavailable';end if;
 v_token:=public.next_doctor_token(p_doctor_id,v_date);
 insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
 values(p_patient_id,p_doctor_id,v_department,p_visit_type,v_date,v_token,p_fee_paise,'waiting',p_previous_visit_id,p_notes,p_idempotency_key) returning id into v_visit;
 if p_collected_paise>0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,p_collected_paise,p_payment_mode,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'VISIT_CREATED','visit',v_visit,jsonb_build_object('token',v_token,'per_doctor_series',true));
 return query select v_visit,v_token;
end $function$
;

-- dispense_prescription(uuid,jsonb,payment_mode,uuid,bigint)
CREATE OR REPLACE FUNCTION public.dispense_prescription(p_prescription_id uuid, p_lines jsonb, p_payment_mode payment_mode, p_idempotency_key uuid, p_consultation_collected_paise bigint DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role; v_sale_id uuid; v_patient_id uuid; v_ip_ticket_id uuid; v_source public.sale_source;
  v_line jsonb; v_item public.prescription_items%rowtype; v_batch public.medicine_batches%rowtype;
  v_qty integer; v_total bigint := 0; v_remaining integer; v_visit_id uuid; v_outstanding bigint;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_consultation_collected_paise < 0 then raise exception 'invalid consultation payment'; end if;
  select id into v_sale_id from public.pharmacy_sales where idempotency_key=p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;
  select v.patient_id,p.ip_ticket_id,p.visit_id,case when p.ip_ticket_id is null then 'op'::public.sale_source else 'ip'::public.sale_source end
    into v_patient_id,v_ip_ticket_id,v_visit_id,v_source from public.prescriptions p left join public.visits v on v.id=p.visit_id
    where p.id=p_prescription_id and p.status in ('pending','partially_dispensed') for update of p;
  if not found or v_patient_id is null then
    select i.patient_id,p.ip_ticket_id,'ip'::public.sale_source into v_patient_id,v_ip_ticket_id,v_source
    from public.prescriptions p join public.ip_tickets i on i.id=p.ip_ticket_id where p.id=p_prescription_id for update of p;
    v_visit_id := null;
  end if;
  if v_patient_id is null then raise exception 'prescription unavailable'; end if;
  insert into public.pharmacy_sales(prescription_id,patient_id,source,ip_ticket_id,payment_mode,idempotency_key)
    values(p_prescription_id,v_patient_id,v_source,v_ip_ticket_id,p_payment_mode,p_idempotency_key) returning id into v_sale_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer; if v_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v_item from public.prescription_items where id=(v_line->>'prescription_item_id')::uuid and prescription_id=p_prescription_id for update;
    if not found or v_item.dispensed_quantity+v_qty > v_item.requested_quantity then raise exception 'quantity exceeds pending prescription'; end if;
    select * into v_batch from public.medicine_batches where id=(v_line->>'batch_id')::uuid and medicine_id=v_item.medicine_id and active for update;
    if not found or v_batch.quantity < v_qty or v_batch.expiry_date < current_date then raise exception 'batch stock unavailable'; end if;
    update public.medicine_batches set quantity=quantity-v_qty,updated_at=now() where id=v_batch.id;
    update public.prescription_items set dispensed_quantity=dispensed_quantity+v_qty where id=v_item.id;
    insert into public.pharmacy_sale_items(sale_id,prescription_item_id,batch_id,quantity,unit_price_paise) values(v_sale_id,v_item.id,v_batch.id,v_qty,v_batch.selling_price_paise);
    v_total := v_total + v_qty*v_batch.selling_price_paise;
  end loop;
  update public.pharmacy_sales set total_paise=v_total where id=v_sale_id;
  select count(*) into v_remaining from public.prescription_items where prescription_id=p_prescription_id and dispensed_quantity<requested_quantity;
  update public.prescriptions set status=case when v_remaining=0 then 'dispensed'::public.prescription_status else 'partially_dispensed'::public.prescription_status end where id=p_prescription_id;
  if v_source='ip' then insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key)
    values(v_ip_ticket_id,'pharmacy','Pharmacy medicines',1,v_total,'pharmacy_sale',v_sale_id,p_idempotency_key); end if;
  -- OP consultation fee collected at the pharmacy counter.
  -- Guarded against over-collection: a partial dispense comes back later with a
  -- fresh idempotency key, so the early-return above would not catch a second
  -- attempt to charge the same consultation.
  if p_consultation_collected_paise > 0 and v_visit_id is not null then
    select greatest(0, v.fee_paise - coalesce(sum(vp.amount_paise),0))
      into v_outstanding
      from public.visits v
      left join public.visit_payments vp on vp.visit_id = v.id
      where v.id = v_visit_id
      group by v.fee_paise;
    if p_consultation_collected_paise > coalesce(v_outstanding,0) then
      raise exception 'consultation payment exceeds outstanding balance' using errcode='23514';
    end if;
    insert into public.visit_payments(visit_id,amount_paise,mode,notes,idempotency_key)
      values(v_visit_id,p_consultation_collected_paise,p_payment_mode,'Collected at pharmacy counter',p_idempotency_key);
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      values(auth.uid(),'PAYMENT_ADDED','visit',v_visit_id,jsonb_build_object('amount_paise',p_consultation_collected_paise,'source','pharmacy'));
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'PHARMACY_DISPENSED','pharmacy_sale',v_sale_id,jsonb_build_object('amount_paise',v_total));
  return v_sale_id;
end $function$
;

-- expire_stale_prescriptions()
CREATE OR REPLACE FUNCTION public.expire_stale_prescriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.expire_stale_prescriptions_internal();
end
$function$
;

-- get_visit_financial_summaries(uuid[])
CREATE OR REPLACE FUNCTION public.get_visit_financial_summaries(p_visit_ids uuid[])
 RETURNS TABLE(visit_id uuid, fee_paise bigint, collected_paise bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 return query select v.id,v.fee_paise,coalesce(sum(p.amount_paise),0)::bigint from public.visits v left join public.visit_payments p on p.visit_id=v.id where v.id=any(p_visit_ids) group by v.id;
end $function$
;

-- list_admission_referrals(integer)
CREATE OR REPLACE FUNCTION public.list_admission_referrals(p_limit integer DEFAULT 50)
 RETURNS TABLE(consultation_id uuid, visit_id uuid, patient_id uuid, patient_name text, patient_phone text, doctor_name text, ward_type text, admission_reason text, assessment text, recommended_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','ip') then
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
    and not exists (select 1 from public.ip_tickets t where t.source_visit_id = c.visit_id)
  order by c.completed_at desc
  limit least(greatest(p_limit,1),200);
end $function$
;

-- list_available_dispense_batches(integer)
CREATE OR REPLACE FUNCTION public.list_available_dispense_batches(p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, medicine_id uuid, batch_number text, expiry_date date, quantity integer, selling_price_paise bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.id,b.medicine_id,b.batch_number,b.expiry_date,b.quantity,b.selling_price_paise from public.medicine_batches b where b.active and b.quantity>0 and b.expiry_date>=current_date order by b.expiry_date limit least(greatest(p_limit,1),500);
end $function$
;

-- list_medicine_directory(text,integer,integer)
CREATE OR REPLACE FUNCTION public.list_medicine_directory(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, brand_name text, generic_name text, strength text, dosage_form text, manufacturer text, active boolean, available_quantity bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select m.id,m.brand_name,m.generic_name,m.strength,m.dosage_form,m.manufacturer,m.active,coalesce(sum(b.quantity) filter(where b.active and b.expiry_date>=current_date),0)::bigint,count(*) over() from public.medicine_directory m left join public.medicine_batches b on b.medicine_id=m.id where nullif(trim(p_query),'') is null or m.search_text like '%'||lower(trim(p_query))||'%' group by m.id order by m.brand_name limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $function$
;

-- list_pending_consultation_fees(text,integer,integer)
CREATE OR REPLACE FUNCTION public.list_pending_consultation_fees(p_query text DEFAULT NULL::text, p_days integer DEFAULT 7, p_limit integer DEFAULT 100)
 RETURNS TABLE(visit_id uuid, patient_id uuid, token_number integer, visit_date date, patient_name text, patient_phone text, doctor_name text, fee_paise bigint, collected_paise bigint, balance_paise bigint, has_prescription boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','reception','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select v.id,
         v.patient_id,
         v.token_number,
         v.visit_date,
         p.name,
         p.phone_normalized,
         d.display_name,
         v.fee_paise,
         coalesce(paid.total,0)::bigint,
         (v.fee_paise - coalesce(paid.total,0))::bigint,
         -- Flags the case the pharmacy queue can never surface on its own.
         exists(
           select 1 from public.prescriptions rx
           where rx.visit_id = v.id
             and rx.status in ('pending','partially_dispensed','dispensed')
         )
  from public.visits v
  join public.patients p on p.id = v.patient_id
  join public.doctors d on d.id = v.doctor_id
  left join lateral (
    select sum(vp.amount_paise) as total
    from public.visit_payments vp
    where vp.visit_id = v.id
  ) paid on true
  where v.status = 'completed'
    and v.fee_paise > coalesce(paid.total,0)
    and v.visit_date >= ((now() at time zone 'Asia/Kolkata')::date - greatest(p_days,0))
    and (
      v_query is null
      or lower(p.name) like '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
    )
  order by v.visit_date desc, v.token_number
  limit least(greatest(p_limit,1),200);
end $function$
;

-- list_pending_prescriptions(text,integer)
CREATE OR REPLACE FUNCTION public.list_pending_prescriptions(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, prescription_number bigint, status text, created_at timestamp with time zone, expires_at timestamp with time zone, visit_id uuid, ip_ticket_id uuid, token_number integer, source text, patient_name text, patient_phone text, doctor_name text, consultation_fee_paise bigint, consultation_balance_paise bigint, items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select
    p.id,
    p.prescription_number,
    p.status::text,
    p.created_at,
    -- Expiry is derived, not stored: expire_stale_prescriptions() voids anything
    -- still pending 24h after the doctor issued it.
    (p.created_at + interval '24 hours'),
    p.visit_id,
    p.ip_ticket_id,
    v.token_number,
    case when p.ip_ticket_id is not null then 'IP' else 'OP' end,
    coalesce(vp.name, ip.name),
    coalesce(vp.phone_normalized, ip.phone_normalized),
    d.display_name,
    -- The consulting doctor set this fee; the pharmacy counter collects it.
    coalesce(v.fee_paise,0)::bigint,
    greatest(
      0,
      coalesce(v.fee_paise,0) - coalesce(
        (select sum(vp.amount_paise) from public.visit_payments vp where vp.visit_id = v.id),
        0
      )
    )::bigint,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', i.id,
                   'medicine_id', i.medicine_id,
                   'medicine_name', i.medicine_name,
                   'requested_quantity', i.requested_quantity,
                   'dispensed_quantity', i.dispensed_quantity
                 )
                 order by i.created_at
               )
        from public.prescription_items i
        where i.prescription_id = p.id
      ),
      '[]'::jsonb
    )
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  left join public.patients vp on vp.id = v.patient_id
  left join public.ip_tickets t on t.id = p.ip_ticket_id
  left join public.patients ip on ip.id = t.patient_id
  left join public.doctors d on d.id = p.doctor_id
  where p.status in ('pending','partially_dispensed')
    and (
      v_query is null
      or coalesce(vp.name, ip.name) ilike '%'||v_query||'%'
      or coalesce(vp.phone_normalized, ip.phone_normalized) like v_query||'%'
      or v.token_number::text = v_query
      or p.prescription_number::text = regexp_replace(v_query,'\D','','g')
    )
  order by v.token_number nulls last, p.created_at
  limit least(greatest(p_limit,1),200);
end $function$
;

-- list_pharmacy_batches(integer,integer)
CREATE OR REPLACE FUNCTION public.list_pharmacy_batches(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, medicine_id uuid, batch_number text, expiry_date date, quantity integer, purchase_price_paise bigint, selling_price_paise bigint, low_stock_threshold integer, active boolean, brand_name text, generic_name text, strength text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.id,b.medicine_id,b.batch_number,b.expiry_date,b.quantity,b.purchase_price_paise,b.selling_price_paise,b.low_stock_threshold,b.active,m.brand_name,m.generic_name,m.strength,count(*) over() from public.medicine_batches b join public.medicine_directory m on m.id=b.medicine_id order by b.expiry_date,b.batch_number limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $function$
;

-- reassign_visit_consultant(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.reassign_visit_consultant(p_visit_id uuid, p_doctor_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_visit public.visits%rowtype;v_department uuid;v_fee bigint;v_old_doctor uuid;v_token integer;
begin
 v_role:=public.current_app_role();
 if v_role is null or v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason required';end if;
 select * into v_visit from public.visits where id=p_visit_id for update;
 if not found then raise exception 'visit unavailable';end if;
 if v_visit.visit_date<>(now() at time zone 'Asia/Kolkata')::date or v_visit.status not in ('waiting','vitals_pending','ready') then raise exception 'visit can no longer be reassigned';end if;
 if exists(select 1 from public.consultations where visit_id=p_visit_id)
   or exists(select 1 from public.prescriptions where visit_id=p_visit_id)
   or exists(select 1 from public.test_orders where visit_id=p_visit_id) then raise exception 'clinical work already started';end if;
 if v_visit.doctor_id=p_doctor_id then raise exception 'select a different consultant';end if;
 select department_id,case when v_visit.visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
 into v_department,v_fee from public.doctors where id=p_doctor_id and active;
 if not found then raise exception 'consultant unavailable';end if;
 v_old_doctor:=v_visit.doctor_id;
 v_token:=public.next_doctor_token(p_doctor_id,v_visit.visit_date);
 update public.visits set doctor_id=p_doctor_id,department_id=v_department,token_number=v_token where id=p_visit_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'VISIT_CONSULTANT_REASSIGNED','visit',p_visit_id,jsonb_build_object(
   'from_doctor',v_old_doctor,'to_doctor',p_doctor_id,'old_token',v_visit.token_number,'new_token',v_token,'reason',trim(p_reason)));
 return p_visit_id;
end $function$
;

-- record_visit_vitals(uuid,numeric,numeric,numeric,smallint,smallint,smallint,smallint,smallint,text)
CREATE OR REPLACE FUNCTION public.record_visit_vitals(p_visit_id uuid, p_weight_kg numeric, p_height_cm numeric, p_temperature_c numeric, p_bp_systolic smallint, p_bp_diastolic smallint, p_pulse smallint, p_spo2 smallint, p_respiratory_rate smallint, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_id uuid;v_doctor uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null or v_role not in ('admin','op','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.visits where id=p_visit_id and status not in ('completed','cancelled') and (v_role<>'doctor' or doctor_id=v_doctor)) then raise exception 'visit unavailable' using errcode='42501';end if;
 insert into public.vitals(visit_id,weight_kg,height_cm,temperature_c,bp_systolic,bp_diastolic,pulse,spo2,respiratory_rate,notes) values(p_visit_id,p_weight_kg,p_height_cm,p_temperature_c,p_bp_systolic,p_bp_diastolic,p_pulse,p_spo2,p_respiratory_rate,p_notes) on conflict(visit_id) do update set weight_kg=excluded.weight_kg,height_cm=excluded.height_cm,temperature_c=excluded.temperature_c,bp_systolic=excluded.bp_systolic,bp_diastolic=excluded.bp_diastolic,pulse=excluded.pulse,spo2=excluded.spo2,respiratory_rate=excluded.respiratory_rate,notes=excluded.notes,recorded_by=auth.uid(),updated_at=now() returning id into v_id;
 update public.visits set status='ready' where id=p_visit_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'VITALS_RECORDED','visit',p_visit_id);return v_id;
end $function$
;

-- report_admin_overview(date,date)
CREATE OR REPLACE FUNCTION public.report_admin_overview(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;v_from timestamptz;v_to timestamptz;
begin
 if public.current_app_role() is null or public.current_app_role() <> 'admin' then raise exception 'forbidden' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'invalid date range';end if;
 v_from:=p_from::timestamp at time zone 'Asia/Kolkata';v_to:=(p_to+1)::timestamp at time zone 'Asia/Kolkata';
 select jsonb_build_object(
  'total_visits',(select count(*) from public.visits where visit_date between p_from and p_to),
  'unique_patients',(select count(distinct patient_id) from public.visits where visit_date between p_from and p_to),
  'new_patients',(select count(*) from public.patients where created_at>=v_from and created_at<v_to),
  'op_collected_paise',(select coalesce(sum(p.amount_paise),0) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),
  'ip_collected_paise',(select coalesce(sum(amount_paise),0) from public.ip_payments where created_at>=v_from and created_at<v_to),
  'pharmacy_collected_paise',(select coalesce(sum(total_paise),0) from public.pharmacy_sales where source='op' and created_at>=v_from and created_at<v_to),
  'outstanding_paise',(select greatest(0,coalesce((select sum(fee_paise) from public.visits where visit_date between p_from and p_to),0)-coalesce((select sum(p.amount_paise) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),0)+coalesce((select sum(amount_paise) from public.ip_charges where created_at<v_to),0)-coalesce((select sum(amount_paise) from public.ip_payments where created_at<v_to),0))),
  'current_ip',(select count(*) from public.ip_tickets where status in ('admitted','discharge_pending')),
  'visits_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'visits',visits) order by metric_date),'[]'::jsonb) from (select visit_date as metric_date,count(*) as visits from public.visits where visit_date between p_from and p_to group by visit_date) q),
  'collections_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'op',op,'ip',ip,'pharmacy',pharmacy) order by metric_date),'[]'::jsonb) from (select d.metric_date,coalesce(o.amount,0) op,coalesce(i.amount,0) ip,coalesce(ph.amount,0) pharmacy from (select generate_series(p_from,p_to,'1 day')::date as metric_date)d left join (select v.visit_date as metric_date,sum(p.amount_paise) amount from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to group by v.visit_date)o on o.metric_date=d.metric_date left join (select (created_at at time zone 'Asia/Kolkata')::date as metric_date,sum(amount_paise) amount from public.ip_payments where created_at>=v_from and created_at<v_to group by 1)i on i.metric_date=d.metric_date left join (select (created_at at time zone 'Asia/Kolkata')::date as metric_date,sum(total_paise) amount from public.pharmacy_sales where source='op' and created_at>=v_from and created_at<v_to group by 1)ph on ph.metric_date=d.metric_date)q),
  'visits_by_doctor',(select coalesce(jsonb_agg(jsonb_build_object('doctor',display_name,'visits',visits) order by visits desc),'[]'::jsonb) from (select d.display_name,count(*) visits from public.visits v join public.doctors d on d.id=v.doctor_id where v.visit_date between p_from and p_to group by d.id,d.display_name order by visits desc limit 15)q),
  'ip_by_category',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'amount_paise',amount) order by amount desc),'[]'::jsonb) from (select category,sum(amount_paise) amount from public.ip_charges where created_at>=v_from and created_at<v_to group by category)q),
  'top_medicines',(select coalesce(jsonb_agg(jsonb_build_object('medicine',medicine_name,'quantity',quantity) order by quantity desc),'[]'::jsonb) from (select pi.medicine_name,sum(si.quantity) quantity from public.pharmacy_sale_items si join public.prescription_items pi on pi.id=si.prescription_item_id join public.pharmacy_sales s on s.id=si.sale_id where s.created_at>=v_from and s.created_at<v_to group by pi.medicine_name order by quantity desc limit 10)q),
  -- OP tab: when patients actually arrive, and where the queue ends up.
  'visits_by_hour',(select coalesce(jsonb_agg(jsonb_build_object('hour',h.hour,'visits',coalesce(v.visits,0)) order by h.hour),'[]'::jsonb) from (select generate_series(0,23) as hour)h left join (select extract(hour from created_at at time zone 'Asia/Kolkata')::int as hour,count(*) visits from public.visits where visit_date between p_from and p_to group by 1)v on v.hour=h.hour),
  'visits_by_status',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'visits',visits) order by visits desc),'[]'::jsonb) from (select status::text as status,count(*) visits from public.visits where visit_date between p_from and p_to group by status)q),
  -- Doctors tab: workload split between first consultations and follow-ups.
  'doctor_visit_mix',(select coalesce(jsonb_agg(jsonb_build_object('doctor',display_name,'op',op,'follow_up',follow_up) order by op+follow_up desc),'[]'::jsonb) from (select d.display_name,count(*) filter (where v.visit_type='op') op,count(*) filter (where v.visit_type='follow_up') follow_up from public.visits v join public.doctors d on d.id=v.doctor_id where v.visit_date between p_from and p_to group by d.id,d.display_name order by count(*) desc limit 12)q),
  -- IP tab: bed flow per day.
  'ip_flow_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'admissions',admissions,'discharges',discharges) order by metric_date),'[]'::jsonb) from (select d.metric_date,coalesce(a.total,0) admissions,coalesce(x.total,0) discharges from (select generate_series(p_from,p_to,'1 day')::date as metric_date)d left join (select (admission_at at time zone 'Asia/Kolkata')::date as metric_date,count(*) total from public.ip_tickets where admission_at>=v_from and admission_at<v_to group by 1)a on a.metric_date=d.metric_date left join (select (discharge_at at time zone 'Asia/Kolkata')::date as metric_date,count(*) total from public.ip_tickets where discharge_at>=v_from and discharge_at<v_to group by 1)x on x.metric_date=d.metric_date)q),
  -- Pharmacy tab: dispensing value and volume per day.
  'pharmacy_sales_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'amount_paise',amount,'items',items) order by metric_date),'[]'::jsonb) from (select d.metric_date,coalesce(s.amount,0) amount,coalesce(s.items,0) items from (select generate_series(p_from,p_to,'1 day')::date as metric_date)d left join (select (s.created_at at time zone 'Asia/Kolkata')::date as metric_date,sum(s.total_paise) amount,sum(i.quantity) items from public.pharmacy_sales s left join public.pharmacy_sale_items i on i.sale_id=s.id where s.created_at>=v_from and s.created_at<v_to group by 1)s on s.metric_date=d.metric_date)q),
  -- Collections tab: how money arrives, and what is still owed per source.
  'collections_by_mode',(select coalesce(jsonb_agg(jsonb_build_object('mode',mode,'amount_paise',amount) order by amount desc),'[]'::jsonb) from (select mode::text as mode,sum(amount) amount from (select p.mode,p.amount_paise amount from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to union all select mode,amount_paise from public.ip_payments where created_at>=v_from and created_at<v_to union all select payment_mode,total_paise from public.pharmacy_sales where source='op' and payment_mode is not null and created_at>=v_from and created_at<v_to)m group by mode)q),
  'source_balance',(select jsonb_build_array(
    jsonb_build_object('source','OP','collected_paise',(select coalesce(sum(p.amount_paise),0) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),'outstanding_paise',greatest(0,coalesce((select sum(fee_paise) from public.visits where visit_date between p_from and p_to),0)-coalesce((select sum(p.amount_paise) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),0))),
    jsonb_build_object('source','IP','collected_paise',(select coalesce(sum(amount_paise),0) from public.ip_payments where created_at>=v_from and created_at<v_to),'outstanding_paise',greatest(0,coalesce((select sum(amount_paise) from public.ip_charges where created_at>=v_from and created_at<v_to),0)-coalesce((select sum(amount_paise) from public.ip_payments where created_at>=v_from and created_at<v_to),0))),
    jsonb_build_object('source','Pharmacy','collected_paise',(select coalesce(sum(total_paise),0) from public.pharmacy_sales where source='op' and created_at>=v_from and created_at<v_to),'outstanding_paise',0))),
  -- Patients tab: first-time versus returning attendance per day.
  'patients_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'new_patients',new_patients,'returning_patients',returning_patients) order by metric_date),'[]'::jsonb) from (select d.metric_date,coalesce(q.new_patients,0) new_patients,coalesce(q.returning_patients,0) returning_patients from (select generate_series(p_from,p_to,'1 day')::date as metric_date)d left join (select v.visit_date as metric_date,count(distinct v.patient_id) filter (where (pt.created_at at time zone 'Asia/Kolkata')::date=v.visit_date) new_patients,count(distinct v.patient_id) filter (where (pt.created_at at time zone 'Asia/Kolkata')::date<v.visit_date) returning_patients from public.visits v join public.patients pt on pt.id=v.patient_id where v.visit_date between p_from and p_to group by v.visit_date)q on q.metric_date=d.metric_date)q)
 ) into v_result;
 return v_result;
end $function$
;

-- review_patient_report(uuid)
CREATE OR REPLACE FUNCTION public.review_patient_report(p_report_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_doctor uuid;v_test uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 select r.test_order_id into v_test from public.patient_reports r left join public.visits v on v.id=r.visit_id left join public.test_orders t on t.id=r.test_order_id left join public.ip_tickets i on i.id=r.ip_ticket_id where r.id=p_report_id and (v_role='admin' or v.doctor_id=v_doctor or t.doctor_id=v_doctor or i.doctor_id=v_doctor) for update of r;
 if not found then raise exception 'report unavailable' using errcode='42501';end if;
 update public.patient_reports set status='reviewed' where id=p_report_id;
 if v_test is not null then update public.test_orders set status='reviewed' where id=v_test;end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'REPORT_REVIEWED','patient_report',p_report_id);
 return p_report_id;
end $function$
;

-- save_ip_discharge_summary(uuid,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.save_ip_discharge_summary(p_ticket_id uuid, p_final_diagnosis text, p_hospital_course text, p_treatment_summary text, p_discharge_medicines text, p_discharge_advice text, p_follow_up text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_doctor uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 perform set_config('app.ip_discharge_workflow','on',true);
 update public.ip_tickets set final_diagnosis=p_final_diagnosis,hospital_course=p_hospital_course,treatment_summary=p_treatment_summary,discharge_medicines=p_discharge_medicines,discharge_advice=p_discharge_advice,follow_up=p_follow_up,status='discharge_pending' where id=p_ticket_id and status in ('admitted','discharge_pending') and (v_role='admin' or doctor_id=v_doctor);
 if not found then raise exception 'IP ticket unavailable' using errcode='42501';end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_DISCHARGE_SUMMARY_SAVED','ip_ticket',p_ticket_id);return p_ticket_id;
end $function$
;

-- save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid)
CREATE OR REPLACE FUNCTION public.save_medicine_batch(p_batch_id uuid, p_medicine_id uuid, p_batch_number text, p_expiry_date date, p_quantity_delta integer, p_purchase_price_paise bigint, p_selling_price_paise bigint, p_low_stock_threshold integer, p_active boolean, p_reason text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_id uuid;v_quantity integer;
begin
 v_role:=public.current_app_role();if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 if p_selling_price_paise<0 or p_purchase_price_paise<0 or p_low_stock_threshold<0 then raise exception 'invalid stock metadata';end if;
 select id into v_id from public.stock_movements where idempotency_key=p_idempotency_key;
 if found then select batch_id into v_id from public.stock_movements where idempotency_key=p_idempotency_key;return v_id;end if;
 if p_batch_id is null then
  insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active)
  values(p_medicine_id,trim(p_batch_number),p_expiry_date,0,p_purchase_price_paise,p_selling_price_paise,p_low_stock_threshold,p_active) returning id into v_id;
 else
  update public.medicine_batches set batch_number=trim(p_batch_number),expiry_date=p_expiry_date,purchase_price_paise=p_purchase_price_paise,selling_price_paise=p_selling_price_paise,low_stock_threshold=p_low_stock_threshold,active=p_active where id=p_batch_id and medicine_id=p_medicine_id returning id into v_id;
  if not found then raise exception 'batch unavailable' using errcode='42501';end if;
 end if;
 select quantity into v_quantity from public.medicine_batches where id=v_id for update;
 if v_quantity+p_quantity_delta<0 then raise exception 'stock cannot become negative';end if;
 if p_quantity_delta<>0 then
  update public.medicine_batches set quantity=quantity+p_quantity_delta where id=v_id;
  insert into public.stock_movements(batch_id,quantity_delta,reason,idempotency_key) values(v_id,p_quantity_delta,coalesce(nullif(trim(p_reason),''),'Manual stock adjustment'),p_idempotency_key);
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),case when p_quantity_delta=0 then 'STOCK_METADATA_UPDATED' else 'STOCK_ADJUSTED' end,'medicine_batch',v_id,jsonb_build_object('quantity_delta',p_quantity_delta));
 return v_id;
end $function$
;

-- save_visit_consultation(uuid,text,text,text,text,text,follow_up_type,date,integer,jsonb,jsonb,boolean,bigint,boolean,text,text)
CREATE OR REPLACE FUNCTION public.save_visit_consultation(p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text, p_follow_up_type follow_up_type, p_follow_up_date date, p_follow_up_days integer, p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint DEFAULT NULL::bigint, p_admission_recommended boolean DEFAULT false, p_admission_ward_type text DEFAULT NULL::text, p_admission_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_complete and p_fee_paise is null then
    raise exception 'consultation fee required' using errcode='23514';
  end if;
  if p_fee_paise is not null and p_fee_paise < 0 then
    raise exception 'consultation fee must not be negative' using errcode='23514';
  end if;
  if p_admission_recommended and coalesce(p_admission_ward_type,'') not in ('general','private','icu') then
    raise exception 'ward type required' using errcode='23514';
  end if;
  select doctor_id,patient_id into v_doctor,v_patient from public.visits where id=p_visit_id and status <> 'cancelled' for update;
  if not found or (v_role='doctor' and v_doctor<>public.current_doctor_id()) then raise exception 'visit unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.consultations where visit_id=p_visit_id and status='completed') then raise exception 'completed consultation is immutable'; end if;
  insert into public.consultations(visit_id,doctor_id,symptoms,history,examination,assessment,advice,follow_up_type,follow_up_date,follow_up_days,status,completed_at,admission_recommended,admission_ward_type,admission_reason)
  values(p_visit_id,v_doctor,p_symptoms,p_history,p_examination,p_assessment,p_advice,p_follow_up_type,p_follow_up_date,p_follow_up_days,case when p_complete then 'completed'::public.consultation_status else 'draft'::public.consultation_status end,case when p_complete then now() end,coalesce(p_admission_recommended,false),case when p_admission_recommended then p_admission_ward_type end,case when p_admission_recommended then p_admission_reason end)
  on conflict(visit_id) do update set symptoms=excluded.symptoms,history=excluded.history,examination=excluded.examination,assessment=excluded.assessment,advice=excluded.advice,follow_up_type=excluded.follow_up_type,follow_up_date=excluded.follow_up_date,follow_up_days=excluded.follow_up_days,status=excluded.status,completed_at=excluded.completed_at,admission_recommended=excluded.admission_recommended,admission_ward_type=excluded.admission_ward_type,admission_reason=excluded.admission_reason
  returning id into v_consultation;
  insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'draft') on conflict(visit_id) do update set updated_at=now() returning id into v_prescription;
  delete from public.prescription_items where prescription_id=v_prescription;
  for v_line in select value from jsonb_array_elements(coalesce(p_medicines,'[]'::jsonb)) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;
  delete from public.test_orders where visit_id=p_visit_id and status in ('ordered','report_pending');
  for v_line in select value from jsonb_array_elements(coalesce(p_tests,'[]'::jsonb)) loop
    insert into public.test_orders(patient_id,visit_id,doctor_id,test_name,status,notes) values(v_patient,p_visit_id,v_doctor,v_line->>'test_name','ordered',v_line->>'notes');
  end loop;
  if p_fee_paise is not null then
    update public.visits set fee_paise=p_fee_paise where id=p_visit_id;
  end if;
  if p_complete then
    update public.prescriptions set status=case when jsonb_array_length(coalesce(p_medicines,'[]'::jsonb))>0 then 'pending'::public.prescription_status else 'cancelled'::public.prescription_status end where id=v_prescription;
    update public.visits set status='completed' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'CONSULTATION_COMPLETED','visit',p_visit_id,jsonb_build_object('fee_paise',p_fee_paise,'admission_recommended',coalesce(p_admission_recommended,false)));
  else
    update public.visits set status='in_consultation' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'CONSULTATION_DRAFT_SAVED','visit',p_visit_id);
  end if;
  return v_consultation;
end $function$
;

-- save_visit_consultation(uuid,text,text,text,text,text,follow_up_type,date,integer,jsonb,jsonb,boolean,bigint)
CREATE OR REPLACE FUNCTION public.save_visit_consultation(p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text, p_follow_up_type follow_up_type, p_follow_up_date date, p_follow_up_days integer, p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
  -- A completed consultation must carry a fee. 0 is allowed and deliberate
  -- (free follow-up); NULL means the doctor never entered one.
  if p_complete and p_fee_paise is null then
    raise exception 'consultation fee required' using errcode='23514';
  end if;
  if p_fee_paise is not null and p_fee_paise < 0 then
    raise exception 'consultation fee must not be negative' using errcode='23514';
  end if;
  select doctor_id,patient_id into v_doctor,v_patient from public.visits where id=p_visit_id and status <> 'cancelled' for update;
  if not found or (v_role='doctor' and v_doctor<>public.current_doctor_id()) then raise exception 'visit unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.consultations where visit_id=p_visit_id and status='completed') then raise exception 'completed consultation is immutable'; end if;
  insert into public.consultations(visit_id,doctor_id,symptoms,history,examination,assessment,advice,follow_up_type,follow_up_date,follow_up_days,status,completed_at)
  values(p_visit_id,v_doctor,p_symptoms,p_history,p_examination,p_assessment,p_advice,p_follow_up_type,p_follow_up_date,p_follow_up_days,case when p_complete then 'completed'::public.consultation_status else 'draft'::public.consultation_status end,case when p_complete then now() end)
  on conflict(visit_id) do update set symptoms=excluded.symptoms,history=excluded.history,examination=excluded.examination,assessment=excluded.assessment,advice=excluded.advice,follow_up_type=excluded.follow_up_type,follow_up_date=excluded.follow_up_date,follow_up_days=excluded.follow_up_days,status=excluded.status,completed_at=excluded.completed_at
  returning id into v_consultation;
  insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'draft') on conflict(visit_id) do update set updated_at=now() returning id into v_prescription;
  delete from public.prescription_items where prescription_id=v_prescription;
  for v_line in select value from jsonb_array_elements(coalesce(p_medicines,'[]'::jsonb)) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;
  delete from public.test_orders where visit_id=p_visit_id and status in ('ordered','report_pending');
  for v_line in select value from jsonb_array_elements(coalesce(p_tests,'[]'::jsonb)) loop
    insert into public.test_orders(patient_id,visit_id,doctor_id,test_name,status,notes) values(v_patient,p_visit_id,v_doctor,v_line->>'test_name','ordered',v_line->>'notes');
  end loop;
  if p_fee_paise is not null then
    update public.visits set fee_paise=p_fee_paise where id=p_visit_id;
  end if;
  if p_complete then
    update public.prescriptions set status=case when jsonb_array_length(coalesce(p_medicines,'[]'::jsonb))>0 then 'pending'::public.prescription_status else 'cancelled'::public.prescription_status end where id=v_prescription;
    update public.visits set status='completed' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'CONSULTATION_COMPLETED','visit',p_visit_id,jsonb_build_object('fee_paise',p_fee_paise));
  else
    update public.visits set status='in_consultation' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'CONSULTATION_DRAFT_SAVED','visit',p_visit_id);
  end if;
  return v_consultation;
end $function$
;

-- search_clinical_terms(text,text,integer)
CREATE OR REPLACE FUNCTION public.search_clinical_terms(p_term_type text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, term_type text, display_text text, code text, code_system text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','doctor','op','ip') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select t.id, t.term_type, t.display_text, t.code, t.code_system
  from public.clinical_terms t
  where t.active
    and t.term_type = p_term_type
    and (
      v_query is null
      or t.normalized_text like v_query||'%'
      or t.normalized_text like '% '||v_query||'%'
      or lower(coalesce(t.code,'')) like v_query||'%'
      or exists (select 1 from unnest(t.search_aliases) a where lower(a) like v_query||'%')
    )
  order by
    case when t.normalized_text like v_query||'%' then 0 else 1 end,
    t.display_text
  limit least(greatest(p_limit,1),25);
end $function$
;

-- search_inventory_items(text,integer)
CREATE OR REPLACE FUNCTION public.search_inventory_items(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, item_code integer, name text, unit text, selling_price_paise bigint, quantity integer, low_stock_threshold integer, expiry_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select i.id,i.item_code,i.name,i.unit,i.selling_price_paise,i.quantity,i.low_stock_threshold,i.expiry_date
  from public.inventory_items i
  where i.active
    and (v_query is null or i.search_text like '%'||v_query||'%')
  order by i.name
  limit least(greatest(p_limit,1),100);
end $function$
;

-- search_medicine_availability(text,integer)
CREATE OR REPLACE FUNCTION public.search_medicine_availability(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, brand_name text, generic_name text, strength text, dosage_form text, quantity bigint, low_stock_threshold bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_query text;
begin
 v_role:=public.current_app_role();
 if v_role is null or v_role not in ('admin','doctor','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 v_query:=lower(trim(p_query));
 if v_query='' then return; end if;
 return query
 select m.id,m.brand_name,m.generic_name,m.strength,m.dosage_form,
        coalesce(sum(b.quantity) filter(where b.active and b.expiry_date>=current_date),0)::bigint,
        coalesce(sum(b.low_stock_threshold) filter(where b.active),0)::bigint
 from public.medicine_directory m
 left join public.medicine_batches b on b.medicine_id=m.id
 where m.active
   and (m.search_text like v_query||'%' or m.search_text like '% '||v_query||'%')
 group by m.id
 order by
   case
     when lower(m.brand_name)=v_query then 0            -- exact brand
     when m.search_text like v_query||'%' then 1        -- brand prefix
     when lower(coalesce(m.generic_name,'')) like v_query||'%' then 2 -- generic prefix
     else 3                                             -- any other word prefix
   end,
   m.brand_name
 limit least(greatest(p_limit,1),25);
end $function$
;

-- storage_usage_summary()
CREATE OR REPLACE FUNCTION public.storage_usage_summary()
 RETURNS TABLE(bucket_id text, object_count bigint, total_bytes bigint, quota_bytes bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() is null or public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select b.id,
         count(o.id),
         coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         b.file_size_limit
  from storage.buckets b
  left join storage.objects o on o.bucket_id = b.id
  group by b.id, b.file_size_limit
  order by b.id;
end $function$
;

-- visit_consultation_balance(uuid)
CREATE OR REPLACE FUNCTION public.visit_consultation_balance(p_prescription_id uuid)
 RETURNS TABLE(visit_id uuid, fee_paise bigint, collected_paise bigint, balance_paise bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select v.id,
         v.fee_paise,
         coalesce(sum(vp.amount_paise),0)::bigint,
         greatest(0, v.fee_paise - coalesce(sum(vp.amount_paise),0))::bigint
  from public.prescriptions p
  join public.visits v on v.id = p.visit_id
  left join public.visit_payments vp on vp.visit_id = v.id
  where p.id = p_prescription_id
  group by v.id, v.fee_paise;
end $function$
;

commit;
