begin;

-- 1. list_pending_prescriptions carries enough of each line to print/render
--    like an actual prescription (form, strength, dose, frequency), not just
--    the medicine name and quantity.
create or replace function public.list_pending_prescriptions(
  p_query text default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  prescription_number bigint,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  visit_id uuid,
  ip_ticket_id uuid,
  token_number integer,
  source text,
  patient_name text,
  patient_phone text,
  doctor_name text,
  consultation_fee_paise bigint,
  consultation_balance_paise bigint,
  items jsonb
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select
    p.id,
    p.prescription_number,
    p.status::text,
    p.created_at,
    (p.created_at + interval '24 hours'),
    p.visit_id,
    p.ip_ticket_id,
    v.token_number,
    case when p.ip_ticket_id is not null then 'IP' else 'OP' end,
    coalesce(vp.name, ip.name),
    coalesce(vp.phone_normalized, ip.phone_normalized),
    d.display_name,
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
                   'dose', i.dose,
                   'frequency', i.frequency,
                   'duration', i.duration,
                   'route', i.route,
                   'dosage_form', md.dosage_form,
                   'strength', md.strength,
                   'requested_quantity', i.requested_quantity,
                   'dispensed_quantity', i.dispensed_quantity
                 )
                 order by i.created_at
               )
        from public.prescription_items i
        left join public.medicine_directory md on md.id = i.medicine_id
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
end $$;

revoke all on function public.list_pending_prescriptions(text,integer) from public;
grant execute on function public.list_pending_prescriptions(text,integer) to authenticated;

-- 2. dispense_prescription can also raise a line's requested_quantity in the
--    same transaction as dispensing, so the pharmacist can hand over "10
--    instead of 5" (an extra day or two of therapy the patient asks for at
--    the counter) without a separate screen. The bump is audited; it can only
--    increase, never used to silently shrink what was prescribed.
create or replace function public.dispense_prescription(
  p_prescription_id uuid,
  p_lines jsonb,
  p_payment_mode public.payment_mode,
  p_idempotency_key uuid,
  p_consultation_collected_paise bigint default 0
)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role; v_sale_id uuid; v_patient_id uuid; v_ip_ticket_id uuid; v_source public.sale_source;
  v_line jsonb; v_item public.prescription_items%rowtype; v_batch public.medicine_batches%rowtype;
  v_qty integer; v_total bigint := 0; v_remaining integer; v_visit_id uuid; v_outstanding bigint;
  v_amount bigint; v_piece_price bigint; v_new_requested integer;
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
    if not found then raise exception 'quantity exceeds pending prescription'; end if;

    -- Optional, pharmacist-entered increase of what was prescribed (e.g. the
    -- patient asks for a couple of extra days). Only ever raises the line.
    v_new_requested := nullif(v_line->>'new_requested_quantity','')::integer;
    if v_new_requested is not null and v_new_requested > v_item.requested_quantity then
      if v_new_requested > 100000 then raise exception 'invalid quantity'; end if;
      update public.prescription_items set requested_quantity=v_new_requested where id=v_item.id;
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
        values(auth.uid(),'PRESCRIPTION_ITEM_QUANTITY_INCREASED','prescription_item',v_item.id,
               jsonb_build_object('old_quantity',v_item.requested_quantity,'new_quantity',v_new_requested));
      v_item.requested_quantity := v_new_requested;
    end if;

    if v_item.dispensed_quantity+v_qty > v_item.requested_quantity then raise exception 'quantity exceeds pending prescription'; end if;
    select * into v_batch from public.medicine_batches where id=(v_line->>'batch_id')::uuid and medicine_id=v_item.medicine_id and active for update;
    if not found or v_batch.quantity < v_qty or v_batch.expiry_date < current_date then raise exception 'batch stock unavailable'; end if;
    update public.medicine_batches set quantity=quantity-v_qty,updated_at=now() where id=v_batch.id;
    update public.prescription_items set dispensed_quantity=dispensed_quantity+v_qty where id=v_item.id;

    v_amount := round(v_qty::numeric * v_batch.selling_price_paise / greatest(v_batch.units_per_pack,1));
    v_piece_price := round(v_batch.selling_price_paise::numeric / greatest(v_batch.units_per_pack,1));
    insert into public.pharmacy_sale_items(sale_id,prescription_item_id,batch_id,quantity,unit_price_paise,amount_paise)
      values(v_sale_id,v_item.id,v_batch.id,v_qty,v_piece_price,v_amount);
    v_total := v_total + v_amount;
  end loop;

  update public.pharmacy_sales set total_paise=v_total where id=v_sale_id;
  select count(*) into v_remaining from public.prescription_items where prescription_id=p_prescription_id and dispensed_quantity<requested_quantity;
  update public.prescriptions set status=case when v_remaining=0 then 'dispensed'::public.prescription_status else 'partially_dispensed'::public.prescription_status end where id=p_prescription_id;
  if v_source='ip' then insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key)
    values(v_ip_ticket_id,'pharmacy','Pharmacy medicines',1,v_total,'pharmacy_sale',v_sale_id,p_idempotency_key); end if;

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
end $$;

revoke all on function public.dispense_prescription(uuid,jsonb,public.payment_mode,uuid,bigint) from public, anon;
grant execute on function public.dispense_prescription(uuid,jsonb,public.payment_mode,uuid,bigint) to authenticated, service_role;

-- 3. "Dispense as Per Rx": the consultant wrote the prescription on paper and
--    never touched the system. Pharmacy enters it digitally against the
--    patient's OP visit or IP ticket so it flows through the same pending
--    queue and dispense screen as a doctor-entered one. Doctor attribution is
--    kept (paper prescriptions are still somebody's clinical decision), and
--    for OP the visit's consultation fee gate stays exactly as it is
--    elsewhere: dispensing cannot complete until it is collected.
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

    insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'pending')
    on conflict(visit_id) do update set doctor_id=excluded.doctor_id,updated_at=now()
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

    select id into v_prescription from public.prescriptions
      where ip_ticket_id=p_ip_ticket_id and status in ('pending','partially_dispensed')
      order by created_at desc limit 1;
    if v_prescription is null then
      insert into public.prescriptions(ip_ticket_id,doctor_id,status) values(p_ip_ticket_id,v_doctor,'pending') returning id into v_prescription;
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',
           greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;

  update public.prescriptions set status = case
      when exists(select 1 from public.prescription_items where prescription_id=v_prescription and dispensed_quantity<requested_quantity) then
        case when exists(select 1 from public.prescription_items where prescription_id=v_prescription and dispensed_quantity>0)
             then 'partially_dispensed'::public.prescription_status else 'pending'::public.prescription_status end
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

-- 4. Lets pharmacy pick "which patient" for a paper prescription without
--    granting a direct SELECT on visits/patients: today's OP visits only,
--    searchable by name, phone, UHID or token.
create or replace function public.list_today_op_visits_for_pharmacy(p_query text default null, p_limit integer default 50)
returns table(
  visit_id uuid, patient_id uuid, patient_name text, patient_phone text, patient_uhid text,
  token_number integer, status text, doctor_name text, fee_paise bigint, has_digital_consultation boolean
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select v.id, p.id, p.name, p.phone_normalized, p.uhid, v.token_number, v.status::text, d.display_name, v.fee_paise,
    exists(select 1 from public.consultations c where c.visit_id=v.id and c.status='completed')
  from public.visits v
  join public.patients p on p.id=v.patient_id
  join public.doctors d on d.id=v.doctor_id
  where v.visit_date = current_date
    and v.status <> 'cancelled'
    and (
      v_query is null
      or lower(p.name) like '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
      or lower(p.uhid) like v_query||'%'
    )
  order by v.token_number
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_today_op_visits_for_pharmacy(text,integer) from public, anon;
grant execute on function public.list_today_op_visits_for_pharmacy(text,integer) to authenticated, service_role;

-- 5. Same idea for IP: pharmacy picks an admitted patient's ticket to enter a
--    paper prescription against, without a direct SELECT on ip_tickets.
create or replace function public.list_admitted_ip_tickets_for_pharmacy(p_query text default null, p_limit integer default 50)
returns table(
  ip_ticket_id uuid, patient_id uuid, patient_name text, patient_phone text, patient_uhid text,
  ticket_number text, status text, doctor_name text, room text, bed text
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select t.id, p.id, p.name, p.phone_normalized, p.uhid, t.ticket_number, t.status::text, d.display_name, t.room, t.bed
  from public.ip_tickets t
  join public.patients p on p.id=t.patient_id
  join public.doctors d on d.id=t.doctor_id
  where t.status in ('admitted','discharge_pending')
    and (
      v_query is null
      or lower(p.name) like '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or lower(t.ticket_number) like '%'||v_query||'%'
      or lower(p.uhid) like v_query||'%'
    )
  order by t.admission_at desc
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_admitted_ip_tickets_for_pharmacy(text,integer) from public, anon;
grant execute on function public.list_admitted_ip_tickets_for_pharmacy(text,integer) to authenticated, service_role;

commit;
