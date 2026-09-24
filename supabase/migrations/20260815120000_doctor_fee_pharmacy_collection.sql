-- Consultation fee ownership moves from Reception to the consulting doctor.
--
-- Before: reception picked the doctor, the doctor's configured op_fee/follow_up_fee
-- was copied onto the visit at creation, and reception collected cash up front.
-- After: the doctor types the fee to complete the consultation, and the pharmacy
-- counter collects it while dispensing. One authoritative number, two roles.
--
-- Sequencing note: this migration is additive. Reception can still collect, so
-- the money flow is never broken mid-deploy. Removing the fee fields from the
-- Create Visit dialog is a separate, later step.
begin;

-- 1. Doctor sets the fee when completing -------------------------------------
-- Rebuilt rather than overloaded: a 13-argument sibling would make every
-- existing PostgREST call ambiguous.
drop function if exists public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean);

create function public.save_visit_consultation(
  p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text,
  p_follow_up_type public.follow_up_type, p_follow_up_date date, p_follow_up_days integer,
  p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
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
end $$;

revoke all on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean,bigint) from public;
grant execute on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean,bigint) to authenticated;

-- 2. Pharmacy reads the fee it has to collect --------------------------------
-- visit_payments is readable only by admin/reception, and visits' finance
-- columns are equally restricted, so pharmacy needs a narrow definer view of
-- exactly one visit's outstanding consultation balance.
create or replace function public.visit_consultation_balance(p_prescription_id uuid)
returns table(visit_id uuid, fee_paise bigint, collected_paise bigint, balance_paise bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() not in ('admin','pharmacy','reception') then
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
end $$;

revoke all on function public.visit_consultation_balance(uuid) from public;
grant execute on function public.visit_consultation_balance(uuid) to authenticated;

-- 3. Pharmacy collects the fee inside the dispense transaction ---------------
-- Folded into dispense rather than exposed as a standalone payment RPC so the
-- collection cannot be skipped, double-submitted, or left orphaned if the
-- dispense itself fails. The payment is keyed off the dispense idempotency key,
-- so a retried dispense re-uses the same sale AND the same payment row.
drop function if exists public.dispense_prescription(uuid,jsonb,public.payment_mode,uuid);

create function public.dispense_prescription(
  p_prescription_id uuid,
  p_lines jsonb,
  p_payment_mode public.payment_mode,
  p_idempotency_key uuid,
  p_consultation_collected_paise bigint default 0
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role; v_sale_id uuid; v_patient_id uuid; v_ip_ticket_id uuid; v_source public.sale_source;
  v_line jsonb; v_item public.prescription_items%rowtype; v_batch public.medicine_batches%rowtype;
  v_qty integer; v_total bigint := 0; v_remaining integer; v_visit_id uuid; v_outstanding bigint;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
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
end $$;

revoke all on function public.dispense_prescription(uuid,jsonb,public.payment_mode,uuid,bigint) from public;
grant execute on function public.dispense_prescription(uuid,jsonb,public.payment_mode,uuid,bigint) to authenticated;

commit;
