-- Stock had no unit at all: `quantity = 400` could mean 400 tablets or 400
-- strips depending on who typed it, and the pharmacist could not tell.
--
-- From here:
--   * quantity is always PIECES (tablets, capsules, ml, whatever the form is)
--   * units_per_pack records how many pieces are in one strip / box / bottle
--   * selling_price_paise is the price of ONE PACK
--
-- So a strip of 30 at Rs 35 is: units_per_pack = 30, selling_price_paise = 3500,
-- and 400 pieces in stock reads as "400 tablets (13 strips + 10)".
--
-- Existing rows get units_per_pack = 1, which makes pack price = piece price:
-- every price already in the database keeps its current meaning and no stock
-- figure changes.
begin;

alter table public.medicine_batches
  add column if not exists units_per_pack integer not null default 1
    check (units_per_pack >= 1 and units_per_pack <= 10000);

comment on column public.medicine_batches.quantity is
  'Stock in pieces (tablets/capsules/ml), never in packs.';
comment on column public.medicine_batches.units_per_pack is
  'Pieces in one pack (strip/box/bottle). 1 means the item is sold as single pieces.';
comment on column public.medicine_batches.selling_price_paise is
  'Price of ONE PACK. The piece price is derived: selling_price_paise / units_per_pack.';

-- A sale line's amount was a generated column, quantity * unit_price_paise.
-- With pack pricing that is wrong at the rupee level: Rs 35 per strip of 30 is
-- 116.67 paise a tablet, so a full strip would bill 30 x 117 = Rs 35.10 and the
-- patient would be overcharged 10 paise on every strip. The amount is now
-- computed once from the pack price and stored exactly, with unit_price_paise
-- kept as the per-piece figure the receipt prints.
alter table public.pharmacy_sale_items add column if not exists amount_exact_paise bigint;
update public.pharmacy_sale_items set amount_exact_paise = amount_paise where amount_exact_paise is null;
alter table public.pharmacy_sale_items drop column amount_paise;
alter table public.pharmacy_sale_items rename column amount_exact_paise to amount_paise;
alter table public.pharmacy_sale_items alter column amount_paise set not null;
alter table public.pharmacy_sale_items add constraint pharmacy_sale_items_amount_nonneg check (amount_paise >= 0);

-- 1. Dispensing ----------------------------------------------------------
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
  v_amount bigint; v_piece_price bigint;
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
    -- Quantities are always pieces. The dispense screen converts packs to
    -- pieces before sending, so stock arithmetic has one unit only.
    v_qty := (v_line->>'quantity')::integer; if v_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v_item from public.prescription_items where id=(v_line->>'prescription_item_id')::uuid and prescription_id=p_prescription_id for update;
    if not found or v_item.dispensed_quantity+v_qty > v_item.requested_quantity then raise exception 'quantity exceeds pending prescription'; end if;
    select * into v_batch from public.medicine_batches where id=(v_line->>'batch_id')::uuid and medicine_id=v_item.medicine_id and active for update;
    if not found or v_batch.quantity < v_qty or v_batch.expiry_date < current_date then raise exception 'batch stock unavailable'; end if;
    update public.medicine_batches set quantity=quantity-v_qty,updated_at=now() where id=v_batch.id;
    update public.prescription_items set dispensed_quantity=dispensed_quantity+v_qty where id=v_item.id;

    -- The pack price is the authority. The amount is derived from it in one
    -- rounding step, so a whole pack always bills at exactly the pack price;
    -- the per-piece figure is stored only for the receipt line.
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

  -- OP consultation fee collected at the pharmacy counter, guarded against
  -- over-collection because a partial dispense returns later with a fresh key.
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

-- 2. Batches carry the pack size ----------------------------------------
create or replace function public.save_medicine_batch(
  p_batch_id uuid, p_medicine_id uuid, p_batch_number text, p_expiry_date date,
  p_quantity_delta integer, p_purchase_price_paise bigint, p_selling_price_paise bigint,
  p_low_stock_threshold integer, p_active boolean, p_reason text, p_idempotency_key uuid,
  p_units_per_pack integer default 1
)
returns uuid
language plpgsql security definer set search_path='' as $$
declare v_role public.app_role; v_id uuid; v_quantity integer; v_pack integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_selling_price_paise<0 or p_purchase_price_paise<0 or p_low_stock_threshold<0 then raise exception 'invalid stock metadata'; end if;
  v_pack := greatest(coalesce(p_units_per_pack,1),1);

  select id into v_id from public.stock_movements where idempotency_key=p_idempotency_key;
  if found then select batch_id into v_id from public.stock_movements where idempotency_key=p_idempotency_key; return v_id; end if;

  if p_batch_id is null then
    insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active,units_per_pack)
    values(p_medicine_id,trim(p_batch_number),p_expiry_date,0,p_purchase_price_paise,p_selling_price_paise,p_low_stock_threshold,p_active,v_pack) returning id into v_id;
  else
    update public.medicine_batches set batch_number=trim(p_batch_number),expiry_date=p_expiry_date,purchase_price_paise=p_purchase_price_paise,
      selling_price_paise=p_selling_price_paise,low_stock_threshold=p_low_stock_threshold,active=p_active,units_per_pack=v_pack
    where id=p_batch_id and medicine_id=p_medicine_id returning id into v_id;
    if not found then raise exception 'batch unavailable' using errcode='42501'; end if;
  end if;

  select quantity into v_quantity from public.medicine_batches where id=v_id for update;
  if v_quantity+p_quantity_delta<0 then raise exception 'stock cannot become negative'; end if;
  if p_quantity_delta<>0 then
    update public.medicine_batches set quantity=quantity+p_quantity_delta where id=v_id;
    insert into public.stock_movements(batch_id,quantity_delta,reason,idempotency_key)
      values(v_id,p_quantity_delta,coalesce(nullif(trim(p_reason),''),'Manual stock adjustment'),p_idempotency_key);
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),case when p_quantity_delta=0 then 'STOCK_METADATA_UPDATED' else 'STOCK_ADJUSTED' end,'medicine_batch',v_id,
           jsonb_build_object('quantity_delta',p_quantity_delta,'units_per_pack',v_pack));
  return v_id;
end $$;

-- The eleven-argument version would stay callable and silently reset the pack
-- size to its default, because PostgREST resolves an overload by the arguments
-- it is handed.
drop function if exists public.save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid);
revoke all on function public.save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid,integer) from public, anon;
grant execute on function public.save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid,integer) to authenticated, service_role;

-- 3. The dispense screen needs the pack size to offer strips -------------
drop function if exists public.list_available_dispense_batches(integer);
create or replace function public.list_available_dispense_batches(p_limit integer default 500)
returns table(
  id uuid, medicine_id uuid, batch_number text, expiry_date date,
  quantity integer, selling_price_paise bigint, units_per_pack integer
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select b.id,b.medicine_id,b.batch_number,b.expiry_date,b.quantity,b.selling_price_paise,b.units_per_pack
  from public.medicine_batches b
  where b.active and b.quantity>0 and b.expiry_date>=current_date
  order by b.expiry_date
  limit least(greatest(p_limit,1),500);
end $$;

revoke all on function public.list_available_dispense_batches(integer) from public, anon;
grant execute on function public.list_available_dispense_batches(integer) to authenticated, service_role;

-- 4. Receipt reads the stored amount rather than recomputing it ----------
create or replace function public.get_sale_receipt(p_sale_id uuid)
returns table(
  sale_id uuid, created_at timestamptz, source text, payment_mode text, dispensed_by text,
  patient_name text, patient_phone text, patient_uhid text, visit_id uuid, token_number integer,
  prescription_number bigint, doctor_name text, medicines_paise bigint, consultation_paise bigint, items jsonb
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','pharmacy','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select
    s.id, s.created_at, s.source::text, s.payment_mode::text, pr.full_name,
    pt.name, pt.phone_normalized, pt.uhid, v.id, v.token_number,
    rx.prescription_number, d.display_name,
    coalesce(s.total_paise,0)::bigint,
    coalesce((select sum(vp.amount_paise) from public.visit_payments vp
              where vp.idempotency_key = s.idempotency_key),0)::bigint,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', i.medicine_name,
                  'batch', b.batch_number,
                  'quantity', si.quantity,
                  'units_per_pack', coalesce(b.units_per_pack,1),
                  'unit_price_paise', si.unit_price_paise,
                  'amount_paise', si.amount_paise
                )
                order by i.medicine_name)
       from public.pharmacy_sale_items si
       join public.prescription_items i on i.id = si.prescription_item_id
       left join public.medicine_batches b on b.id = si.batch_id
       where si.sale_id = s.id),
      '[]'::jsonb
    )
  from public.pharmacy_sales s
  left join public.profiles pr on pr.id = s.dispensed_by
  left join public.patients pt on pt.id = s.patient_id
  left join public.prescriptions rx on rx.id = s.prescription_id
  left join public.visits v on v.id = rx.visit_id
  left join public.doctors d on d.id = rx.doctor_id
  where s.id = p_sale_id;
end $$;

revoke all on function public.get_sale_receipt(uuid) from public, anon;
grant execute on function public.get_sale_receipt(uuid) to authenticated, service_role;

-- 5. Bulk import carries the pack size ----------------------------------
create or replace function public.bulk_import_medicines(p_rows jsonb, p_file_name text, p_idempotency_key uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_job uuid;v_row jsonb;v_medicine uuid;v_batch uuid;v_created_medicines integer:=0;v_new_batches integer:=0;v_updated_batches integer:=0;v_row_count integer;v_pack integer;
begin
 v_role:=public.current_app_role();if v_role is null or v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 v_row_count:=jsonb_array_length(p_rows);if v_row_count<1 or v_row_count>1000 then raise exception 'row count must be between 1 and 1000';end if;
 select id into v_job from public.bulk_import_jobs where idempotency_key=p_idempotency_key;
 if v_job is not null then return (select jsonb_build_object('job_id',id,'row_count',row_count,'success_count',success_count,'created_medicines',coalesce((select (metadata->>'created_medicines')::integer from public.audit_logs where entity_id=id and action='BULK_MEDICINE_IMPORT_COMPLETED' order by created_at desc limit 1),0)) from public.bulk_import_jobs where id=v_job);end if;
 insert into public.bulk_import_jobs(file_name,row_count,status,idempotency_key) values(left(p_file_name,255),v_row_count,'processing',p_idempotency_key) returning id into v_job;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_pack := greatest(coalesce(nullif(v_row->>'units_per_pack','')::integer,1),1);
  select id into v_medicine from public.medicine_directory where lower(regexp_replace(trim(brand_name),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'medicine_name'),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(generic_name,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'generic_name','')),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(strength,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'strength','')),'\s+',' ','g')) and lower(regexp_replace(trim(dosage_form),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'dosage_form'),'\s+',' ','g'));
  if v_medicine is null then
   insert into public.medicine_directory(brand_name,generic_name,strength,dosage_form,manufacturer,active,source) values(v_row->>'medicine_name',nullif(v_row->>'generic_name',''),nullif(v_row->>'strength',''),v_row->>'dosage_form',nullif(v_row->>'manufacturer',''),coalesce((v_row->>'active')::boolean,true),'bulk import') returning id into v_medicine;v_created_medicines:=v_created_medicines+1;
  end if;
  select id into v_batch from public.medicine_batches where medicine_id=v_medicine and lower(regexp_replace(trim(batch_number),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'batch_number'),'\s+',' ','g')) for update;
  if v_batch is not null then
   update public.medicine_batches set quantity=quantity+(v_row->>'opening_quantity')::integer,expiry_date=(v_row->>'expiry_date')::date,purchase_price_paise=nullif(v_row->>'purchase_price_paise','')::bigint,selling_price_paise=(v_row->>'selling_price_paise')::bigint,low_stock_threshold=coalesce((v_row->>'low_stock_threshold')::integer,10),active=coalesce((v_row->>'active')::boolean,true),units_per_pack=v_pack,updated_at=now() where id=v_batch;v_updated_batches:=v_updated_batches+1;
  else
   insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active,units_per_pack) values(v_medicine,v_row->>'batch_number',(v_row->>'expiry_date')::date,(v_row->>'opening_quantity')::integer,nullif(v_row->>'purchase_price_paise','')::bigint,(v_row->>'selling_price_paise')::bigint,coalesce((v_row->>'low_stock_threshold')::integer,10),coalesce((v_row->>'active')::boolean,true),v_pack);v_new_batches:=v_new_batches+1;
  end if;
 end loop;
 update public.bulk_import_jobs set success_count=v_row_count,error_count=0,status='ready',completed_at=now() where id=v_job;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'BULK_MEDICINE_IMPORT_COMPLETED','bulk_import_job',v_job,jsonb_build_object('file_name',p_file_name,'row_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches));
 return jsonb_build_object('job_id',v_job,'row_count',v_row_count,'success_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches);
exception when others then
 if v_job is not null then update public.bulk_import_jobs set status='failed',error_count=v_row_count,completed_at=now() where id=v_job;end if;raise;
end $$;

commit;
