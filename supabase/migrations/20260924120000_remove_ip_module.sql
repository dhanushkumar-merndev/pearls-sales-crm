-- Pearl Aesthetic CRM: remove the in-patient (IP) module and separate the
-- OP desk from reception again.
--
-- Pearl is an OP-only aesthetic clinic. This drops IP tickets, charges,
-- payments, progress notes, discharge, room/bed management and IP item
-- requests, and rewrites every shared function (dispensing, procedure
-- billing, dashboards, analytics, receipts) without its IP branch.
--
-- Safety: it refuses to run against a database that holds IP records, so it
-- can never silently destroy real admission history.

do $$
begin
  if exists (select 1 from public.ip_tickets)
     or exists (select 1 from public.ip_charges)
     or exists (select 1 from public.ip_payments)
     or exists (select 1 from public.ip_inventory_requests)
     or exists (select 1 from public.prescriptions where ip_ticket_id is not null)
     or exists (select 1 from public.pharmacy_sales where source = 'ip' or ip_ticket_id is not null)
     or exists (select 1 from public.procedure_sales where ip_ticket_id is not null)
  then
    raise exception 'IP records exist. Export and archive them before removing the IP module.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Schema: IP tables, columns and types
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['ip_tickets', 'ip_charges', 'ip_payments', 'ip_progress_notes',
    'ip_inventory_requests', 'ip_inventory_request_items', 'room_beds']
  loop
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.prescriptions drop column if exists ip_ticket_id cascade;
alter table public.test_orders drop column if exists ip_ticket_id cascade;
alter table public.patient_reports drop column if exists ip_ticket_id cascade;
alter table public.pharmacy_sales drop column if exists ip_ticket_id cascade;
alter table public.procedure_sales drop column if exists ip_ticket_id cascade;
alter table public.doctors drop column if exists ip_visit_fee_paise cascade;
alter table public.consultations
  drop column if exists admission_recommended cascade,
  drop column if exists admission_ward_type cascade,
  drop column if exists admission_reason cascade;

drop table if exists
  public.ip_inventory_request_items,
  public.ip_inventory_requests,
  public.ip_payments,
  public.ip_charges,
  public.ip_progress_notes,
  public.ip_tickets,
  public.room_beds
cascade;

drop type if exists public.ip_status;
drop type if exists public.charge_category;

-- sale_source keeps its 'ip' label (Postgres cannot drop an enum value);
-- every pharmacy sale is now an OP counter sale.
alter table public.pharmacy_sales
  add constraint pharmacy_sales_op_only check (source = 'op');

-- Every IP-only routine, all overloads.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = any(array[
        'add_configured_ip_charge', 'add_custom_ip_charge', 'add_ip_charges',
        'add_ip_progress_note', 'assign_ip_ticket', 'assign_ip_ticket_patient',
        'complete_ip_discharge', 'create_ip_inventory_request', 'create_ip_ticket',
        'fulfill_ip_inventory_request', 'fulfill_ip_inventory_request_without_stock_ledger',
        'get_ip_financial_summaries', 'get_ip_inventory_request_receipt',
        'list_admission_referrals', 'list_admitted_ip_tickets_for_pharmacy',
        'list_ip_inventory_requests', 'list_ip_staff_workload',
        'list_pending_ip_inventory_requests', 'pharmacy_may_view_ip_ticket',
        'protect_ip_discharge_workflow', 'save_ip_discharge_summary',
        'search_ip_stock_catalog', 'create_manual_prescription',
        'require_settled_op_fee',
        -- Superseded by the single dashboard_metric_detail_for_role below.
        'dashboard_metric_detail', 'dashboard_metric_detail_for_role_before_reception_op_merge',
        'dashboard_summary_internal'
      ])
  loop
    execute format('drop function %s cascade', r.sig);
  end loop;
end $$;

-- The clinic price list: consultations, procedures, treatments, tests.
update public.charges set category = 'Procedure' where category in ('Room', 'Bed', 'Ward', 'IP Doctor');
alter table public.charges
  add constraint charges_category_check
  check (category in ('OP', 'Follow-up', 'Procedure', 'Treatment', 'Test', 'Other'));

-- ---------------------------------------------------------------------------
-- 2. Shared routines without IP
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_hospital_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_action text;v_entity text;v_entity_id uuid;v_meta jsonb:='{}'::jsonb;
begin
 case tg_table_name
  when 'patients' then v_action:='PATIENT_CREATED';v_entity:='patient';v_entity_id:=new.id;
  when 'visit_payments' then v_action:='PAYMENT_ADDED';v_entity:='visit';v_entity_id:=new.visit_id;v_meta:=jsonb_build_object('amount_paise',new.amount_paise);
  when 'patient_reports' then v_action:='REPORT_UPLOADED';v_entity:='patient_report';v_entity_id:=new.id;
  else return new;
 end case;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),v_action,v_entity,v_entity_id,v_meta);
 return new;
end $function$
;;

CREATE OR REPLACE FUNCTION public.validate_report_relationship()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.visit_id is not null and not exists(select 1 from public.visits where id=new.visit_id and patient_id=new.patient_id) then raise exception 'report visit does not belong to patient';end if;
 if new.test_order_id is not null and not exists(select 1 from public.test_orders where id=new.test_order_id and patient_id=new.patient_id and visit_id is not distinct from new.visit_id) then raise exception 'report test order relationship is invalid';end if;
 if new.test_order_id is not null then update public.test_orders set status='report_ready' where id=new.test_order_id and status in ('ordered','report_pending');end if;
 return new;
end $function$
;;

CREATE OR REPLACE FUNCTION public.review_patient_report(p_report_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_doctor uuid;v_test uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 select r.test_order_id into v_test from public.patient_reports r left join public.visits v on v.id=r.visit_id left join public.test_orders t on t.id=r.test_order_id where r.id=p_report_id and (v_role='admin' or v.doctor_id=v_doctor or t.doctor_id=v_doctor) for update of r;
 if not found then raise exception 'report unavailable' using errcode='42501';end if;
 update public.patient_reports set status='reviewed' where id=p_report_id;
 if v_test is not null then update public.test_orders set status='reviewed' where id=v_test;end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'REPORT_REVIEWED','patient_report',p_report_id);
 return p_report_id;
end $function$
;;

CREATE OR REPLACE FUNCTION public.operational_data_signature()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role;v_doctor uuid;v_value text;v_medicines timestamptz;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null then raise exception 'forbidden' using errcode='42501';end if;
 select max(updated_at) into v_medicines from public.medicine_directory;
 case v_role
  when 'reception' then select concat_ws('|',max(v.updated_at),(select max(created_at) from public.visit_payments),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.consultations),(select max(updated_at) from public.leads where status in ('booked','converted')),v_medicines) into v_value from public.visits v;
  when 'op' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.vitals),(select max(updated_at) from public.patient_reports),v_medicines) into v_value from public.visits v;
  when 'doctor' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.consultations where doctor_id=v_doctor),(select max(updated_at) from public.patient_reports),v_medicines) into v_value from public.visits v where v.doctor_id=v_doctor;
  when 'pharmacy' then select concat_ws('|',max(p.updated_at),(select max(updated_at) from public.medicine_batches),(select max(created_at) from public.pharmacy_sales),v_medicines) into v_value from public.prescriptions p;
  when 'sales_executive' then select concat_ws('|',max(l.updated_at),(select max(a.created_at) from public.lead_activities a join public.leads x on x.id=a.lead_id where x.assigned_to=auth.uid())) into v_value from public.leads l where l.assigned_to=auth.uid();
  else select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.prescriptions),(select max(updated_at) from public.medicine_batches),(select max(updated_at) from public.leads),v_medicines) into v_value from public.visits v;
 end case;
 return md5(coalesce(v_value,''));
end $function$;

drop function if exists public.list_doctor_workload();
CREATE FUNCTION public.list_doctor_workload()
 RETURNS TABLE(id uuid, display_name text, department text, op_fee_paise bigint, follow_up_fee_paise bigint, op_active integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with op_load as (
    select v.doctor_id, count(*)::integer as active
    from public.visits v
    where v.status in ('waiting', 'in_consultation')
      and v.visit_date = (now() at time zone 'Asia/Kolkata')::date
    group by v.doctor_id
  )
  select
    d.id,
    d.display_name,
    coalesce(dep.name, '—'),
    d.op_fee_paise::bigint,
    d.follow_up_fee_paise::bigint,
    coalesce(op_load.active, 0)
  from public.doctors d
  left join public.departments dep on dep.id = d.department_id
  left join op_load on op_load.doctor_id = d.id
  where d.active
  order by d.display_name;
$function$;

drop function if exists public.get_procedure_bill_receipt(uuid);
CREATE FUNCTION public.get_procedure_bill_receipt(p_sale_id uuid)
 RETURNS TABLE(sale_id uuid, sale_number integer, created_at timestamp with time zone, procedure_name text, procedure_fee_paise bigint, items_total_paise bigint, total_paise bigint, payment_mode text, patient_name text, patient_phone text, patient_uhid text, doctor_name text, billed_by text, items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select
    s.id, s.sale_number, s.created_at, s.procedure_name, s.procedure_fee_paise,
    s.items_total_paise, s.total_paise, s.payment_mode::text,
    pt.name, pt.phone_normalized, pt.uhid, d.display_name, pr.full_name,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', inv.name,
                  'quantity', si.quantity,
                  'unit_price_paise', si.unit_price_paise,
                  'amount_paise', si.quantity * si.unit_price_paise
                )
                order by inv.name)
       from public.procedure_sale_items si
       join public.inventory_items inv on inv.id = si.inventory_item_id
       where si.sale_id = s.id),
      '[]'::jsonb
    )
  from public.procedure_sales s
  left join public.patients pt on pt.id = s.patient_id
  left join public.doctors d on d.id = s.doctor_id
  left join public.profiles pr on pr.id = s.created_by
  where s.id = p_sale_id;
end $function$
;;

drop function if exists public.list_procedure_sales(text, integer, integer);
CREATE FUNCTION public.list_procedure_sales(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, sale_number integer, procedure_name text, procedure_fee_paise bigint, items_total_paise bigint, total_paise bigint, payment_mode text, created_at timestamp with time zone, patient_name text, patient_uhid text, doctor_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select
    s.id, s.sale_number, s.procedure_name, s.procedure_fee_paise, s.items_total_paise,
    s.total_paise, s.payment_mode::text, s.created_at,
    pt.name, pt.uhid, d.display_name,
    count(*) over()
  from public.procedure_sales s
  left join public.patients pt on pt.id = s.patient_id
  left join public.doctors d on d.id = s.doctor_id
  where v_query is null
     or pt.name ilike '%'||v_query||'%'
     or pt.phone_normalized like '%'||regexp_replace(v_query,'\D','','g')||'%'
     or s.procedure_name ilike '%'||v_query||'%'
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit,50),1),200)
  offset greatest(p_offset, 0);
end $function$
;;

drop function if exists public.list_pending_prescriptions(text, integer, text, integer);
CREATE FUNCTION public.list_pending_prescriptions(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_status_filter text DEFAULT 'pending'::text, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, prescription_number bigint, status text, created_at timestamp with time zone, expires_at timestamp with time zone, visit_id uuid, token_number integer, source text, patient_name text, patient_phone text, doctor_name text, consultation_fee_paise bigint, consultation_balance_paise bigint, items jsonb, latest_sale_id uuid, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text; v_statuses public.prescription_status[];
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := nullif(trim(coalesce(p_query, '')), '');
  v_statuses := case p_status_filter
    when 'completed' then array['dispensed', 'unavailable']::public.prescription_status[]
    when 'all' then array[
      'pending', 'partially_dispensed', 'dispensed',
      'unavailable', 'expired', 'cancelled'
    ]::public.prescription_status[]
    else array['pending', 'partially_dispensed']::public.prescription_status[]
  end;
  return query
  select
    p.id, p.prescription_number, p.status::text, p.created_at,
    (p.created_at + interval '24 hours'), p.visit_id,
    v.token_number,
    'OP'::text,
    vp.name,
    vp.phone_normalized, d.display_name,
    coalesce(v.fee_paise, 0)::bigint,
    greatest(0, coalesce(v.fee_paise, 0) - coalesce(
      (select sum(pay.amount_paise) from public.visit_payments pay where pay.visit_id = v.id), 0
    ))::bigint,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'medicine_id', i.medicine_id,
        'medicine_name', i.medicine_name, 'dose', i.dose,
        'frequency', i.frequency, 'duration', i.duration,
        'route', i.route, 'dosage_form', md.dosage_form,
        'strength', md.strength,
        'requested_quantity', i.requested_quantity,
        'dispensed_quantity', i.dispensed_quantity
      ) order by i.created_at)
      from public.prescription_items i
      left join public.medicine_directory md on md.id = i.medicine_id
      where i.prescription_id = p.id
    ), '[]'::jsonb),
    (select s.id from public.pharmacy_sales s
      where s.prescription_id = p.id order by s.created_at desc limit 1),
    count(*) over()
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  left join public.patients vp on vp.id = v.patient_id
  left join public.doctors d on d.id = p.doctor_id
  where (
    p.status = any(v_statuses)
    or (p_status_filter = 'pending' and p.status = 'dispensed'
        and p.updated_at > now() - interval '10 minutes')
  )
    and (
      v_query is null
      or vp.name ilike '%' || v_query || '%'
      or vp.phone_normalized like v_query || '%'
      or v.token_number::text = v_query
      or p.prescription_number::text = regexp_replace(v_query, '\D', '', 'g')
    )
  order by
    case when p_status_filter = 'pending' then v.token_number end nulls last,
    case when p_status_filter <> 'pending' then p.created_at end desc,
    p.created_at
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
end;
$function$
;;

CREATE OR REPLACE FUNCTION public.list_pharmacy_sales(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, source text, total_paise bigint, patient_name text, patient_phone text, dispensed_by text, item_count bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_query text;
  v_digits text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := nullif(trim(coalesce(p_query, '')), '');
  v_digits := regexp_replace(coalesce(v_query, ''), '\D', '', 'g');

  return query
  with activity as (
    select
      sale.id,
      sale.created_at,
      sale.source::text as source,
      sale.total_paise,
      patient.name::text as patient_name,
      patient.phone_normalized::text as patient_phone,
      profile.full_name::text as dispensed_by,
      (
        select count(*)
        from public.pharmacy_sale_items sale_item
        where sale_item.sale_id = sale.id
      )::bigint as item_count
    from public.pharmacy_sales sale
    left join public.patients patient on patient.id = sale.patient_id
    left join public.profiles profile on profile.id = sale.dispensed_by

  ), matched as (
    select activity.*
    from activity
    where v_query is null
       or activity.patient_name ilike '%' || v_query || '%'
       or (
         v_digits <> ''
         and activity.patient_phone like right(v_digits, 10) || '%'
       )
  )
  select
    matched.id,
    matched.created_at,
    matched.source,
    matched.total_paise,
    matched.patient_name,
    matched.patient_phone,
    matched.dispensed_by,
    matched.item_count,
    count(*) over () as total_count
  from matched
  order by matched.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end
$function$
;;

CREATE OR REPLACE FUNCTION public.dispense_prescription(p_prescription_id uuid, p_lines jsonb, p_payment_mode payment_mode, p_idempotency_key uuid, p_consultation_collected_paise bigint DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_sale_id uuid;
  v_patient_id uuid;
  v_source public.sale_source;
  v_line jsonb;
  v_item public.prescription_items%rowtype;
  v_batch public.medicine_batches%rowtype;
  v_qty integer;
  v_total bigint := 0;
  v_remaining integer;
  v_visit_id uuid;
  v_outstanding bigint := 0;
  v_amount bigint;
  v_piece_price bigint;
  v_sale_item_id uuid;
  v_excess integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '23514';
  end if;
  if p_lines is null
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one dispense line is required' using errcode = '23514';
  end if;
  if coalesce(p_consultation_collected_paise, 0) < 0 then
    raise exception 'invalid consultation payment' using errcode = '23514';
  end if;

  select id into v_sale_id
  from public.pharmacy_sales
  where idempotency_key = p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;

  select
    v.patient_id,
    p.visit_id,
    'op'::public.sale_source
  into v_patient_id, v_visit_id, v_source
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  where p.id = p_prescription_id
    and p.status in ('pending', 'partially_dispensed')
    and p.created_at > now() - interval '24 hours'
  for update of p;

  if v_patient_id is null then
    raise exception 'prescription expired or unavailable' using errcode = '23514';
  end if;

  -- Collection is not an editable selling price. The consultation form may
  -- save an authorized fee override; dispensing collects that visit's exact
  -- current outstanding value, never a client-selected amount.
  begin
    select greatest(0, v.fee_paise - coalesce(sum(vp.amount_paise), 0))
    into v_outstanding
    from public.visits v
    left join public.visit_payments vp on vp.visit_id = v.id
    where v.id = v_visit_id
    group by v.fee_paise;
    if coalesce(p_consultation_collected_paise, 0) <> coalesce(v_outstanding, 0) then
      raise exception 'exact outstanding consultation fee required' using errcode = '23514';
    end if;
  end;

  insert into public.pharmacy_sales(
    prescription_id, patient_id, source, payment_mode, idempotency_key
  ) values (
    p_prescription_id, v_patient_id, v_source,
    p_payment_mode,
    p_idempotency_key
  ) returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if v_line ? 'new_requested_quantity' then
      raise exception 'prescribed quantity cannot be changed at pharmacy'
        using errcode = '23514';
    end if;
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty <= 0 then
      raise exception 'invalid quantity' using errcode = '23514';
    end if;

    select * into v_item
    from public.prescription_items
    where id = (v_line ->> 'prescription_item_id')::uuid
      and prescription_id = p_prescription_id
    for update;
    if not found then
      raise exception 'prescription item not found' using errcode = '23514';
    end if;
    -- The counter may hand over more than was prescribed when the stock is
    -- there. Stock, not the prescription, is the ceiling; the excess is
    -- absorbed into requested_quantity below so dispensed never exceeds it.
    v_excess := greatest(
      0, v_item.dispensed_quantity + v_qty - v_item.requested_quantity
    );

    select * into v_batch
    from public.medicine_batches
    where id = (v_line ->> 'batch_id')::uuid
      and medicine_id = v_item.medicine_id
      and active
    for update;
    if not found or v_batch.quantity < v_qty
       or v_batch.expiry_date < current_date then
      raise exception 'batch stock unavailable' using errcode = '23514';
    end if;

    update public.medicine_batches
    set quantity = quantity - v_qty, updated_at = now()
    where id = v_batch.id;
    -- One statement, so the row never transiently violates the table's
    -- dispensed_quantity <= requested_quantity check. requested_quantity only
    -- ever rises here, which protect_prescription_content() permits.
    update public.prescription_items
    set dispensed_quantity = dispensed_quantity + v_qty,
        requested_quantity = greatest(
          requested_quantity, dispensed_quantity + v_qty
        )
    where id = v_item.id;
    if v_excess > 0 then
      insert into public.audit_logs(
        actor_user_id, action, entity_type, entity_id, metadata
      ) values (
        auth.uid(), 'PRESCRIPTION_QUANTITY_RAISED', 'prescription_item',
        v_item.id,
        jsonb_build_object(
          'prescription_id', p_prescription_id,
          'prescribed_quantity', v_item.requested_quantity,
          'supplied_quantity', v_item.dispensed_quantity + v_qty,
          'excess_quantity', v_excess
        )
      );
    end if;

    v_amount := round(
      v_qty::numeric * v_batch.selling_price_paise
      / greatest(v_batch.units_per_pack, 1)
    );
    v_piece_price := round(
      v_batch.selling_price_paise::numeric
      / greatest(v_batch.units_per_pack, 1)
    );
    insert into public.pharmacy_sale_items(
      sale_id, prescription_item_id, batch_id, quantity,
      unit_price_paise, amount_paise
    ) values (
      v_sale_id, v_item.id, v_batch.id, v_qty,
      v_piece_price, v_amount
    ) returning id into v_sale_item_id;
    -- v_batch was read under `for update` before the decrement above, so
    -- v_batch.quantity is the quantity this movement started from. Recording
    -- it (and the sale it came from) is what lets the ledger be replayed and
    -- reconciled against the batch instead of merely summed.
    insert into public.stock_movements(
      batch_id, quantity_delta, reason, idempotency_key,
      source_type, source_id, quantity_before, quantity_after
    ) values (
      v_batch.id, -v_qty, 'Prescription dispense', v_sale_item_id,
      'pharmacy_sale', v_sale_id, v_batch.quantity, v_batch.quantity - v_qty
    );
    v_total := v_total + v_amount;
  end loop;

  update public.pharmacy_sales set total_paise = v_total where id = v_sale_id;
  select count(*) into v_remaining
  from public.prescription_items
  where prescription_id = p_prescription_id
    and dispensed_quantity < requested_quantity;
  update public.prescriptions
  set status = case when v_remaining = 0
    then 'dispensed'::public.prescription_status
    else 'partially_dispensed'::public.prescription_status end
  where id = p_prescription_id;

  if v_outstanding > 0 then
    insert into public.visit_payments(
      visit_id, amount_paise, mode, notes, idempotency_key
    ) values (
      v_visit_id, v_outstanding, p_payment_mode,
      'Collected at pharmacy counter', p_idempotency_key
    );
    insert into public.audit_logs(
      actor_user_id, action, entity_type, entity_id, metadata
    ) values (
      auth.uid(), 'PAYMENT_ADDED', 'visit', v_visit_id,
      jsonb_build_object('amount_paise', v_outstanding, 'source', 'pharmacy')
    );
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'PHARMACY_DISPENSED', 'pharmacy_sale', v_sale_id,
    jsonb_build_object('amount_paise', v_total)
  );
  return v_sale_id;
end;
$function$
;;

CREATE OR REPLACE FUNCTION public.create_procedure_sale(p_patient_id uuid, p_visit_id uuid, p_doctor_id uuid, p_procedure_name text, p_procedure_fee_paise bigint, p_lines jsonb, p_payment_mode payment_mode, p_notes text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale_id uuid;
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_qty integer;
  v_items_total bigint := 0;
  v_line_index integer := 0;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(trim(p_procedure_name), '') = '' then
    raise exception 'procedure name required' using errcode = '23514';
  end if;
  if p_procedure_fee_paise < 0 then
    raise exception 'invalid procedure fee' using errcode = '23514';
  end if;

  select id into v_sale_id
  from public.procedure_sales
  where idempotency_key = p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;

  insert into public.procedure_sales(
    patient_id, visit_id, doctor_id, procedure_name, procedure_fee_paise,
    payment_mode, notes, idempotency_key
  ) values (
    p_patient_id,
    nullif(p_visit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    p_doctor_id, trim(p_procedure_name), p_procedure_fee_paise,
    p_payment_mode, nullif(trim(coalesce(p_notes, '')), ''), p_idempotency_key
  ) returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_line_index := v_line_index + 1;
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity' using errcode = '23514';
    end if;
    select * into v_item
    from public.inventory_items
    where id = (v_line ->> 'inventory_item_id')::uuid and active
    for update;
    if not found then
      raise exception 'inventory item unavailable' using errcode = '23514';
    end if;
    if v_item.quantity < v_qty then
      raise exception 'insufficient inventory stock' using errcode = '23514';
    end if;

    update public.inventory_items
    set quantity = quantity - v_qty, updated_at = now()
    where id = v_item.id;
    insert into public.procedure_sale_items(
      sale_id, inventory_item_id, quantity, unit_price_paise
    ) values (v_sale_id, v_item.id, v_qty, v_item.selling_price_paise);
    insert into public.inventory_stock_movements(
      inventory_item_id, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key
    ) values (
      v_item.id, -v_qty, v_item.quantity, v_item.quantity - v_qty,
      'Procedure supply', 'procedure_sale', v_sale_id,
      md5('procedure_sale:' || v_sale_id::text || ':line:' || v_line_index)::uuid
    );
    v_items_total := v_items_total + (v_qty * v_item.selling_price_paise);
  end loop;

  update public.procedure_sales
  set items_total_paise = v_items_total,
      total_paise = v_items_total + p_procedure_fee_paise
  where id = v_sale_id;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'PROCEDURE_SALE_CREATED', 'procedure_sale', v_sale_id,
    jsonb_build_object(
      'total_paise', v_items_total + p_procedure_fee_paise,
      'items', jsonb_array_length(coalesce(p_lines, '[]'::jsonb))
    )
  );
  return v_sale_id;
end
$function$
;;

CREATE OR REPLACE FUNCTION public.delete_master_record(p_entity text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_table text;
  v_label_col text;
  v_in_use text;
  v_label text;
  v_archived boolean;
  v_used boolean := false;
  v_mode text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- entity -> table, the column that names it for the audit trail, and an
  -- optional predicate for references a foreign key would NOT refuse.
  select m.t, m.l, m.u into v_table, v_label_col, v_in_use
  from (values
    ('clinical_term',  'clinical_terms',    'display_text',
     'exists(select 1 from public.consultation_diagnoses where term_id = $1)'),
    ('doctor',         'doctors',           'display_name',  null),
    ('department',     'departments',       'name',          null),
    ('charge',         'charges',           'charge_name',   null),
    ('report_category','report_categories', 'name',          null)
  ) as m(e, t, l, u)
  where m.e = p_entity;
  if v_table is null then
    raise exception 'unknown master entity' using errcode = '22023';
  end if;

  execute format(
    'select %I, archived_at is not null from public.%I where id = $1 for update',
    v_label_col, v_table)
  into v_label, v_archived using p_id;
  if v_label is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if v_archived then
    return jsonb_build_object('mode', 'archived', 'label', v_label, 'entity', p_entity);
  end if;

  if v_in_use is not null then
    execute 'select ' || v_in_use into v_used using p_id;
  end if;

  if v_used then
    v_mode := 'archived';
  else
    -- The sub-block is what makes the choice safe for everything else: any
    -- restricting reference, including one a later migration adds that this
    -- function has never heard of, rolls the attempt back to here.
    begin
      execute format('delete from public.%I where id = $1', v_table) using p_id;
      v_mode := 'deleted';
    exception when foreign_key_violation then
      v_mode := 'archived';
    end;
  end if;

  if v_mode = 'archived' then
    execute format(
      'update public.%I set active = false, archived_at = now(), archived_by = auth.uid() where id = $1',
      v_table) using p_id;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when v_mode = 'deleted' then 'MASTER_RECORD_DELETED' else 'MASTER_RECORD_ARCHIVED' end,
    p_entity, p_id, jsonb_build_object('label', v_label)
  );
  return jsonb_build_object('mode', v_mode, 'label', v_label, 'entity', p_entity);
end;
$function$
;;

CREATE OR REPLACE FUNCTION public.restore_master_record(p_entity text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_table text;
  v_label_col text;
  v_label text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select m.t, m.l into v_table, v_label_col
  from (values
    ('clinical_term','clinical_terms','display_text'),
    ('doctor','doctors','display_name'),
    ('department','departments','name'),
    ('charge','charges','charge_name'),
    ('report_category','report_categories','name')
  ) as m(e, t, l)
  where m.e = p_entity;
  if v_table is null then
    raise exception 'unknown master entity' using errcode = '22023';
  end if;

  execute format(
    'update public.%I set active = true, archived_at = null, archived_by = null
     where id = $1 and archived_at is not null returning %I',
    v_table, v_label_col)
  into v_label using p_id;
  if v_label is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'MASTER_RECORD_RESTORED', p_entity, p_id, jsonb_build_object('label', v_label));
  return jsonb_build_object('mode', 'restored', 'label', v_label, 'entity', p_entity);
end;
$function$
;;

drop function if exists public.save_visit_consultation(uuid, text, text, text, text, text, public.follow_up_type, date, integer, jsonb, jsonb, boolean, bigint, boolean, text, text, jsonb);
CREATE FUNCTION public.save_visit_consultation(p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text, p_follow_up_type follow_up_type, p_follow_up_date date, p_follow_up_days integer, p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint DEFAULT NULL::bigint, p_diagnoses jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','doctor','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
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

  delete from public.consultation_diagnoses where consultation_id=v_consultation;
  for v_line in select value from jsonb_array_elements(coalesce(p_diagnoses,'[]'::jsonb)) loop
    insert into public.consultation_diagnoses(consultation_id,term_id,display_text,code,code_system,status,notes)
    values(
      v_consultation,
      nullif(v_line->>'term_id','')::uuid,
      v_line->>'display_text',
      nullif(v_line->>'code',''),
      nullif(v_line->>'code_system',''),
      coalesce(nullif(v_line->>'status','')::public.diagnosis_status,'provisional'),
      nullif(v_line->>'notes','')
    );
  end loop;

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
;;

CREATE OR REPLACE FUNCTION public.report_admin_overview(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_from timestamptz;
  v_to timestamptz;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid date range';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  select jsonb_build_object(
    'total_visits', (
      select count(*) from public.visits
      where visit_date between p_from and p_to
    ),
    'unique_patients', (
      select count(distinct patient_id) from public.visits
      where visit_date between p_from and p_to
    ),
    'new_patients', (
      select count(*) from public.patients
      where created_at >= v_from and created_at < v_to
    ),
    'op_collected_paise', (
      select coalesce(sum(payment.amount_paise), 0)
      from public.visit_payments payment
      join public.visits visit on visit.id = payment.visit_id
      where visit.visit_date between p_from and p_to
    ),
    'pharmacy_collected_paise', (
      select coalesce(sum(collection.amount_paise), 0)
      from (
        select sale.total_paise as amount_paise
        from public.pharmacy_sales sale
        where sale.source = 'op'
          and sale.created_at >= v_from and sale.created_at < v_to
      ) collection
    ),
    'outstanding_paise', (
      select greatest(
        0,
        coalesce((
          select sum(fee_paise) from public.visits
          where visit_date between p_from and p_to
        ), 0)
        - coalesce((
          select sum(payment.amount_paise)
          from public.visit_payments payment
          join public.visits visit on visit.id = payment.visit_id
          where visit.visit_date between p_from and p_to
        ), 0)
      )
    ),
    'visits_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object('date', metric_date, 'visits', visits)
        order by metric_date
      ), '[]'::jsonb)
      from (
        select visit_date as metric_date, count(*) as visits
        from public.visits
        where visit_date between p_from and p_to
        group by visit_date
      ) data
    ),
    'collections_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'date', day.metric_date, 'op', coalesce(op.amount, 0),
          'pharmacy', coalesce(pharmacy.amount, 0)
        ) order by day.metric_date
      ), '[]'::jsonb)
      from (
        select generate_series(p_from, p_to, '1 day')::date as metric_date
      ) day
      left join (
        select visit.visit_date as metric_date, sum(payment.amount_paise) as amount
        from public.visit_payments payment
        join public.visits visit on visit.id = payment.visit_id
        where visit.visit_date between p_from and p_to
        group by visit.visit_date
      ) op on op.metric_date = day.metric_date
      left join (
        select collection.metric_date, sum(collection.amount_paise) as amount
        from (
          select (sale.created_at at time zone 'Asia/Kolkata')::date as metric_date,
            sale.total_paise as amount_paise
          from public.pharmacy_sales sale
          where sale.source = 'op'
            and sale.created_at >= v_from and sale.created_at < v_to
        ) collection
        group by collection.metric_date
      ) pharmacy on pharmacy.metric_date = day.metric_date
    ),
    'visits_by_doctor', (
      select coalesce(jsonb_agg(
        jsonb_build_object('doctor', display_name, 'visits', visits)
        order by visits desc
      ), '[]'::jsonb)
      from (
        select doctor.display_name, count(*) visits
        from public.visits visit
        join public.doctors doctor on doctor.id = visit.doctor_id
        where visit.visit_date between p_from and p_to
        group by doctor.id, doctor.display_name
        order by visits desc
        limit 15
      ) data
    ),
    'top_medicines', (
      select coalesce(jsonb_agg(
        jsonb_build_object('medicine', medicine_name, 'quantity', quantity)
        order by quantity desc
      ), '[]'::jsonb)
      from (
        select prescription_item.medicine_name, sum(sale_item.quantity) quantity
        from public.pharmacy_sale_items sale_item
        join public.prescription_items prescription_item
          on prescription_item.id = sale_item.prescription_item_id
        join public.pharmacy_sales sale on sale.id = sale_item.sale_id
        where sale.created_at >= v_from and sale.created_at < v_to
        group by prescription_item.medicine_name
        order by quantity desc
        limit 10
      ) data
    ),
    'visits_by_hour', (
      select coalesce(jsonb_agg(
        jsonb_build_object('hour', hour.hour, 'visits', coalesce(visits.visits, 0))
        order by hour.hour
      ), '[]'::jsonb)
      from generate_series(0, 23) as hour(hour)
      left join (
        select extract(hour from created_at at time zone 'Asia/Kolkata')::int as hour,
          count(*) visits
        from public.visits
        where visit_date between p_from and p_to
        group by 1
      ) visits on visits.hour = hour.hour
    ),
    'visits_by_status', (
      select coalesce(jsonb_agg(
        jsonb_build_object('status', status, 'visits', visits)
        order by visits desc
      ), '[]'::jsonb)
      from (
        select status::text as status, count(*) visits
        from public.visits
        where visit_date between p_from and p_to
        group by status
      ) data
    ),
    'doctor_visit_mix', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'doctor', display_name, 'op', op, 'follow_up', follow_up
        ) order by op + follow_up desc
      ), '[]'::jsonb)
      from (
        select doctor.display_name,
          count(*) filter (where visit.visit_type = 'op') op,
          count(*) filter (where visit.visit_type = 'follow_up') follow_up
        from public.visits visit
        join public.doctors doctor on doctor.id = visit.doctor_id
        where visit.visit_date between p_from and p_to
        group by doctor.id, doctor.display_name
        order by count(*) desc
        limit 12
      ) data
    ),
    'pharmacy_sales_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'date', day.metric_date,
          'amount_paise', coalesce(sales.amount, 0),
          'items', coalesce(sales.items, 0)
        ) order by day.metric_date
      ), '[]'::jsonb)
      from (
        select generate_series(p_from, p_to, '1 day')::date as metric_date
      ) day
      left join (
        select ledger.metric_date,
          sum(ledger.amount_paise) as amount,
          sum(ledger.item_quantity) as items
        from (
          select
            (sale.created_at at time zone 'Asia/Kolkata')::date as metric_date,
            sale.total_paise as amount_paise,
            coalesce(sum(sale_item.quantity), 0)::bigint as item_quantity
          from public.pharmacy_sales sale
          left join public.pharmacy_sale_items sale_item
            on sale_item.sale_id = sale.id
          where sale.created_at >= v_from and sale.created_at < v_to
          group by sale.id, sale.created_at, sale.total_paise

        ) ledger
        group by ledger.metric_date
      ) sales on sales.metric_date = day.metric_date
    ),
    'collections_by_mode', (
      select coalesce(jsonb_agg(
        jsonb_build_object('mode', mode, 'amount_paise', amount)
        order by amount desc
      ), '[]'::jsonb)
      from (
        select mode::text as mode, sum(amount) amount
        from (
          select payment.mode, payment.amount_paise amount
          from public.visit_payments payment
          join public.visits visit on visit.id = payment.visit_id
          where visit.visit_date between p_from and p_to
          union all
          select sale.payment_mode, sale.total_paise
          from public.pharmacy_sales sale
          where sale.source = 'op' and sale.payment_mode is not null
            and sale.created_at >= v_from and sale.created_at < v_to
        ) collection(mode, amount)
        group by mode
      ) data
    ),
    'source_balance', (
      select jsonb_build_array(
        jsonb_build_object(
          'source', 'OP',
          'collected_paise', (
            select coalesce(sum(payment.amount_paise), 0)
            from public.visit_payments payment
            join public.visits visit on visit.id = payment.visit_id
            where visit.visit_date between p_from and p_to
          ),
          'outstanding_paise', greatest(
            0,
            coalesce((
              select sum(fee_paise) from public.visits
              where visit_date between p_from and p_to
            ), 0)
            - coalesce((
              select sum(payment.amount_paise)
              from public.visit_payments payment
              join public.visits visit on visit.id = payment.visit_id
              where visit.visit_date between p_from and p_to
            ), 0)
          )
        ),
        jsonb_build_object(
          'source', 'Pharmacy',
          'collected_paise', (
            select coalesce(sum(collection.amount_paise), 0)
            from (
              select sale.total_paise as amount_paise
              from public.pharmacy_sales sale
              where sale.source = 'op'
                and sale.created_at >= v_from and sale.created_at < v_to
            ) collection
          ),
          'outstanding_paise', 0
        )
      )
    ),
    'patients_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'date', day.metric_date,
          'new_patients', coalesce(patient_counts.new_patients, 0),
          'returning_patients', coalesce(patient_counts.returning_patients, 0)
        ) order by day.metric_date
      ), '[]'::jsonb)
      from (
        select generate_series(p_from, p_to, '1 day')::date as metric_date
      ) day
      left join (
        select visit.visit_date as metric_date,
          count(distinct visit.patient_id) filter (
            where (patient.created_at at time zone 'Asia/Kolkata')::date = visit.visit_date
          ) new_patients,
          count(distinct visit.patient_id) filter (
            where (patient.created_at at time zone 'Asia/Kolkata')::date < visit.visit_date
          ) returning_patients
        from public.visits visit
        join public.patients patient on patient.id = visit.patient_id
        where visit.visit_date between p_from and p_to
        group by visit.visit_date
      ) patient_counts on patient_counts.metric_date = day.metric_date
    )
  ) into v_result;

  return v_result;
end
$function$
;;
-- ---------------------------------------------------------------------------
-- 3. Dashboards (role-specific KPI payloads, including the leads desk)
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := public.current_app_role();
  v_doctor uuid := public.current_doctor_id();
  v_me uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata'))::timestamp at time zone 'Asia/Kolkata';
  v_payload jsonb;
  v_received bigint;
  v_converted bigint;
begin
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The lead desk sees only its own pipeline -- no clinical or money counts.
  if v_role = 'sales_executive' then
    select count(*) into v_received from public.leads
    where assigned_to = v_me and received_at >= v_month_start;
    select count(*) into v_converted from public.leads
    where assigned_to = v_me and status = 'converted' and converted_at >= v_month_start;
    return jsonb_build_object(
      'leads_new', (select count(*) from public.leads where assigned_to = v_me and status = 'new'),
      'leads_followups_due', (select count(*) from public.leads
        where assigned_to = v_me and status in ('new', 'contacted', 'interested')
          and next_follow_up_at is not null and next_follow_up_at <= now()),
      'leads_booked_today', (select count(*) from public.leads
        where assigned_to = v_me and status in ('booked', 'converted')
          and (appointment_at at time zone 'Asia/Kolkata')::date = v_today),
      'leads_converted_month', v_converted,
      'leads_open', (select count(*) from public.leads
        where assigned_to = v_me and status in ('new', 'contacted', 'interested', 'booked')),
      'leads_conversion_pct', case when v_received > 0 then round(100.0 * v_converted / v_received) else 0 end
    );
  end if;

  v_payload := jsonb_build_object(
    'patients_today', (select count(*) from public.patients where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'patients_seen_today', (select count(distinct v.patient_id) from public.visits v where v.visit_date = v_today and (v_role <> 'doctor' or v.doctor_id = v_doctor)),
    'visits_today', (select count(*) from public.visits v where v.visit_date = v_today and (v_role <> 'doctor' or v.doctor_id = v_doctor)),
    'waiting', (select count(*) from public.visits v where v.visit_date = v_today and v.status in ('waiting', 'vitals_pending') and (v_role <> 'doctor' or v.doctor_id = v_doctor)),
    'ready', (select count(*) from public.visits v where v.visit_date = v_today and v.status = 'ready' and (v_role <> 'doctor' or v.doctor_id = v_doctor)),
    'completed', (select count(*) from public.visits v where v.visit_date = v_today and v.status = 'completed' and (v_role <> 'doctor' or v.doctor_id = v_doctor)),
    'vitals_pending', (select count(*) from public.visits where visit_date = v_today and status in ('waiting', 'vitals_pending')),
    'reports_ready', (select count(*) from public.patient_reports where status = 'ready'),
    'reports_pending', (select count(*) from public.test_orders o where o.status in ('ordered', 'report_pending') and (v_role <> 'doctor' or o.doctor_id = v_doctor)),
    'followups_due', (select count(*) from public.consultations c where c.follow_up_type <> 'none' and c.status = 'completed' and (c.follow_up_date is null or c.follow_up_date <= v_today) and (v_role <> 'doctor' or c.doctor_id = v_doctor)),
    'pending_prescriptions', (select count(*) from public.prescriptions where status in ('pending', 'partially_dispensed')),
    'low_stock', (select count(*) from public.medicine_batches where active and quantity between 1 and low_stock_threshold),
    'out_of_stock', (select count(*) from public.medicine_batches where active and quantity = 0),
    'expiring_soon', (select count(*) from public.medicine_batches where active and quantity > 0 and expiry_date between v_today and v_today + 30),
    'dispensed_today', (select count(*) from public.pharmacy_sales where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'op_collection_paise', (select coalesce(sum(amount_paise), 0) from public.visit_payments where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'pharmacy_sales_today_paise', (select coalesce(sum(total_paise), 0) from public.pharmacy_sales where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'collected_today_paise', (
      select coalesce((select sum(amount_paise) from public.visit_payments where (created_at at time zone 'Asia/Kolkata')::date = v_today), 0)
           + coalesce((select sum(total_paise) from public.pharmacy_sales where source = 'op' and (created_at at time zone 'Asia/Kolkata')::date = v_today), 0)
           + coalesce((select sum(total_paise) from public.procedure_sales where payment_mode is not null and (created_at at time zone 'Asia/Kolkata')::date = v_today), 0)
    )
  );

  return case v_role
    when 'admin' then v_payload || jsonb_build_object(
      'leads_today', (select count(*) from public.leads where (received_at at time zone 'Asia/Kolkata')::date = v_today),
      'leads_unassigned', (select count(*) from public.leads where assigned_to is null and status in ('new', 'contacted', 'interested'))
    )
    when 'reception' then (v_payload - array['pharmacy_sales_today_paise']) || jsonb_build_object(
      'lead_appointments_today', (select count(*) from public.leads
        where status = 'booked' and (appointment_at at time zone 'Asia/Kolkata')::date = v_today)
    )
    when 'pharmacy' then v_payload - array['op_collection_paise', 'collected_today_paise']
    else v_payload - array['op_collection_paise', 'pharmacy_sales_today_paise', 'collected_today_paise']
  end;
end
$function$;

-- One routine behind every clickable KPI: which metrics each role may open,
-- then the rows behind the number.
create or replace function public.dashboard_metric_detail_for_role(p_metric text, p_limit integer default 25)
returns table(primary_text text, secondary_text text, trailing_text text, href text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := public.current_app_role();
  v_doctor uuid := public.current_doctor_id();
  v_me uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if v_role is null or not (
    v_role = 'admin'
    or (v_role = 'reception' and p_metric = any(array[
      'patients_today', 'patients_seen_today', 'visits_today', 'waiting', 'vitals_pending',
      'ready', 'completed', 'followups_due', 'reports_ready', 'reports_pending',
      'collected_today_paise', 'lead_appointments_today']))
    or (v_role = 'op' and p_metric = any(array[
      'patients_seen_today', 'waiting', 'vitals_pending', 'ready', 'completed', 'reports_pending']))
    or (v_role = 'doctor' and p_metric = any(array[
      'waiting', 'ready', 'completed', 'followups_due', 'reports_ready']))
    or (v_role = 'pharmacy' and p_metric = any(array[
      'pending_prescriptions', 'pharmacy_sales_today_paise', 'low_stock', 'out_of_stock',
      'expiring_soon', 'dispensed_today']))
    or (v_role = 'sales_executive' and p_metric = any(array[
      'leads_new', 'leads_followups_due', 'leads_booked_today', 'leads_converted_month', 'leads_open']))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_metric in ('visits_today', 'patients_seen_today', 'waiting', 'ready', 'completed', 'vitals_pending') then
    return query
    select p.name, 'Token #' || v.token_number || ' · ' || d.display_name,
           replace(v.status::text, '_', ' '), '/visits/' || v.id
    from public.visits v
    join public.patients p on p.id = v.patient_id
    join public.doctors d on d.id = v.doctor_id
    where v.visit_date = v_today
      and (v_role <> 'doctor' or v.doctor_id = v_doctor)
      and (
        p_metric in ('visits_today', 'patients_seen_today')
        or (p_metric in ('waiting', 'vitals_pending') and v.status in ('waiting', 'vitals_pending'))
        or (p_metric = 'ready' and v.status = 'ready')
        or (p_metric = 'completed' and v.status = 'completed')
      )
    order by v.token_number
    limit v_limit;

  elsif p_metric = 'patients_today' then
    return query
    select p.name, p.uhid || ' · ' || p.phone_normalized,
           to_char(p.created_at at time zone 'Asia/Kolkata', 'HH12:MI AM'), '/patients/' || p.id
    from public.patients p
    where (p.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by p.created_at desc
    limit v_limit;

  elsif p_metric = 'pending_prescriptions' then
    return query
    select coalesce(p.name, 'Patient'),
           'RX-' || lpad(rx.prescription_number::text, 6, '0') || ' · ' || d.display_name,
           replace(rx.status::text, '_', ' '), '/pharmacy'
    from public.prescriptions rx
    left join public.visits v on v.id = rx.visit_id
    left join public.patients p on p.id = v.patient_id
    join public.doctors d on d.id = rx.doctor_id
    where rx.status in ('pending', 'partially_dispensed')
    order by rx.created_at
    limit v_limit;

  elsif p_metric in ('low_stock', 'out_of_stock', 'expiring_soon') then
    return query
    select m.brand_name,
           'Batch ' || b.batch_number || ' · expires ' || to_char(b.expiry_date, 'DD Mon YYYY'),
           b.quantity || ' left', '/pharmacy/stock'
    from public.medicine_batches b
    join public.medicine_directory m on m.id = b.medicine_id
    where b.active
      and (
        (p_metric = 'low_stock' and b.quantity between 1 and b.low_stock_threshold)
        or (p_metric = 'out_of_stock' and b.quantity = 0)
        or (p_metric = 'expiring_soon' and b.quantity > 0 and b.expiry_date between v_today and v_today + 30)
      )
    order by b.expiry_date
    limit v_limit;

  elsif p_metric in ('dispensed_today', 'pharmacy_sales_today_paise') then
    return query
    select coalesce(p.name, 'Unknown patient'),
           to_char(s.created_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' · ' || coalesce(replace(s.payment_mode::text, '_', ' '), '—'),
           to_char(s.total_paise / 100.0, 'FM999999990.00'), '/print/receipt/' || s.id
    from public.pharmacy_sales s
    left join public.patients p on p.id = s.patient_id
    where (s.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by s.created_at desc
    limit v_limit;

  elsif p_metric = 'reports_ready' then
    return query
    select p.name, r.report_name, replace(r.status::text, '_', ' '),
           case when v_role = 'doctor' then '/doctor/follow-ups' else '/reports' end
    from public.patient_reports r
    join public.patients p on p.id = r.patient_id
    left join public.visits v on v.id = r.visit_id
    left join public.test_orders o on o.id = r.test_order_id
    where r.status = 'ready'
      and (v_role <> 'doctor' or v.doctor_id = v_doctor or o.doctor_id = v_doctor)
    order by r.created_at desc
    limit v_limit;

  elsif p_metric = 'reports_pending' then
    return query
    select p.name, o.test_name, replace(o.status::text, '_', ' '), '/reports'
    from public.test_orders o
    join public.patients p on p.id = o.patient_id
    where o.status in ('ordered', 'report_pending')
      and (v_role <> 'doctor' or o.doctor_id = v_doctor)
    order by o.created_at desc
    limit v_limit;

  elsif p_metric = 'followups_due' then
    return query
    select p.name, coalesce(c.assessment, 'Follow-up'), replace(c.follow_up_type::text, '_', ' '),
           '/visits/' || c.visit_id
    from public.consultations c
    join public.visits v on v.id = c.visit_id
    join public.patients p on p.id = v.patient_id
    where c.follow_up_type <> 'none' and c.status = 'completed'
      and (c.follow_up_date is null or c.follow_up_date <= v_today)
      and (v_role <> 'doctor' or c.doctor_id = v_doctor)
    order by c.completed_at desc
    limit v_limit;

  elsif p_metric in ('op_collection_paise', 'collected_today_paise') then
    return query
    with activity as (
      select vp.created_at as sort_at, p.name::text as primary_text,
             ('Token #' || v.token_number || ' · ' || replace(vp.mode::text, '_', ' '))::text as secondary_text,
             to_char(vp.amount_paise / 100.0, 'FM999999990.00')::text as trailing_text,
             ('/visits/' || v.id)::text as href
      from public.visit_payments vp
      join public.visits v on v.id = vp.visit_id
      join public.patients p on p.id = v.patient_id
      where (vp.created_at at time zone 'Asia/Kolkata')::date = v_today
      union all
      select s.created_at, coalesce(p.name, 'Unknown patient')::text,
             ('Pharmacy · ' || coalesce(replace(s.payment_mode::text, '_', ' '), '—'))::text,
             to_char(s.total_paise / 100.0, 'FM999999990.00')::text,
             ('/print/receipt/' || s.id)::text
      from public.pharmacy_sales s
      left join public.patients p on p.id = s.patient_id
      where p_metric = 'collected_today_paise' and s.source = 'op'
        and (s.created_at at time zone 'Asia/Kolkata')::date = v_today
      union all
      select s.created_at, coalesce(p.name, 'Walk-in')::text,
             ('Procedure · ' || s.procedure_name)::text,
             to_char(s.total_paise / 100.0, 'FM999999990.00')::text,
             ('/print/procedure-bill/' || s.id)::text
      from public.procedure_sales s
      left join public.patients p on p.id = s.patient_id
      where p_metric = 'collected_today_paise' and s.payment_mode is not null
        and (s.created_at at time zone 'Asia/Kolkata')::date = v_today
    )
    select a.primary_text, a.secondary_text, a.trailing_text, a.href
    from activity a
    order by a.sort_at desc
    limit v_limit;

  elsif p_metric in ('leads_today', 'leads_unassigned') then
    return query
    select coalesce(l.full_name, l.phone_raw, 'Lead'),
           coalesce(l.procedure_interest, l.meta_form_name, initcap(l.source)),
           replace(l.status, '_', ' '), '/leads/' || l.id
    from public.leads l
    where (p_metric = 'leads_today' and (l.received_at at time zone 'Asia/Kolkata')::date = v_today)
       or (p_metric = 'leads_unassigned' and l.assigned_to is null and l.status in ('new', 'contacted', 'interested'))
    order by l.received_at desc
    limit v_limit;

  elsif p_metric = 'lead_appointments_today' then
    return query
    select coalesce(l.full_name, 'Lead'),
           coalesce(l.procedure_interest, '—') || ' · ' || coalesce(l.phone_normalized, ''),
           to_char(l.appointment_at at time zone 'Asia/Kolkata', 'HH12:MI AM'),
           '/reception/lead-appointments'
    from public.leads l
    where l.status = 'booked' and (l.appointment_at at time zone 'Asia/Kolkata')::date = v_today
    order by l.appointment_at
    limit v_limit;

  elsif p_metric in ('leads_new', 'leads_followups_due', 'leads_booked_today', 'leads_converted_month', 'leads_open') then
    return query
    select coalesce(l.full_name, l.phone_raw, 'Lead'),
           coalesce(l.procedure_interest, l.meta_form_name, initcap(l.source)),
           case
             when p_metric = 'leads_followups_due' then to_char(l.next_follow_up_at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM')
             when p_metric = 'leads_booked_today' then to_char(l.appointment_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
             else replace(l.status, '_', ' ')
           end,
           '/leads/' || l.id
    from public.leads l
    where l.assigned_to = v_me
      and (
        (p_metric = 'leads_new' and l.status = 'new')
        or (p_metric = 'leads_followups_due' and l.status in ('new', 'contacted', 'interested')
            and l.next_follow_up_at is not null and l.next_follow_up_at <= now())
        or (p_metric = 'leads_booked_today' and l.status in ('booked', 'converted')
            and (l.appointment_at at time zone 'Asia/Kolkata')::date = v_today)
        or (p_metric = 'leads_converted_month' and l.status = 'converted'
            and l.converted_at >= (date_trunc('month', now() at time zone 'Asia/Kolkata'))::timestamp at time zone 'Asia/Kolkata')
        or (p_metric = 'leads_open' and l.status in ('new', 'contacted', 'interested', 'booked'))
      )
    order by coalesce(l.next_follow_up_at, l.appointment_at, l.received_at)
    limit v_limit;
  end if;
end
$function$;

-- Staff activity: counts of recorded work per person (never a quality score).
drop function if exists public.report_staff_activity(date, date);
create function public.report_staff_activity(p_from date, p_to date)
returns table(
  profile_id uuid, full_name text, role text, status text,
  patients_registered bigint, visits_created bigint, vitals_recorded bigint,
  consultations_completed bigint, prescriptions_written bigint, tests_ordered bigint,
  reports_uploaded bigint, op_payments_count bigint, op_payments_paise bigint,
  dispenses bigint, dispensed_paise bigint, stock_movements bigint,
  leads_contacted bigint, lead_calls bigint, leads_booked bigint, leads_converted bigint,
  audited_actions bigint, last_action_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid date range';
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  return query
  select
    profile.id, profile.full_name, profile.role::text, profile.status::text,
    (select count(*) from public.patients x where x.created_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.visits x where x.created_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.vitals x where x.recorded_by = profile.id and x.recorded_at >= v_from and x.recorded_at < v_to),
    (select count(*) from public.consultations x where profile.doctor_id is not null and x.doctor_id = profile.doctor_id
       and x.status = 'completed' and x.completed_at >= v_from and x.completed_at < v_to),
    (select count(*) from public.prescriptions x where profile.doctor_id is not null and x.doctor_id = profile.doctor_id
       and x.status <> 'draft' and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.test_orders x where profile.doctor_id is not null and x.doctor_id = profile.doctor_id
       and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.patient_reports x where x.uploaded_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.visit_payments x where x.collected_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.amount_paise), 0)::bigint from public.visit_payments x
       where x.collected_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.pharmacy_sales x where x.dispensed_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.total_paise), 0)::bigint from public.pharmacy_sales x
       where x.dispensed_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.stock_movements x where x.created_by = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.leads x where x.assigned_to = profile.id
       and x.first_contacted_at >= v_from and x.first_contacted_at < v_to),
    (select count(*) from public.lead_activities x where x.created_by = profile.id and x.type = 'call'
       and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.lead_activities x where x.created_by = profile.id and x.to_status = 'booked'
       and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.leads x where x.assigned_to = profile.id and x.status = 'converted'
       and x.converted_at >= v_from and x.converted_at < v_to),
    (select count(*) from public.audit_logs x where x.actor_user_id = profile.id and x.created_at >= v_from and x.created_at < v_to),
    (select max(x.created_at) from public.audit_logs x where x.actor_user_id = profile.id and x.created_at >= v_from and x.created_at < v_to)
  from public.profiles profile
  order by profile.role, profile.full_name;
end
$function$;

-- ---------------------------------------------------------------------------
-- 4. Role guards: OP desk separate from reception; no `ip` role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_visit_vitals(p_visit_id uuid, p_weight_kg numeric, p_height_cm numeric, p_temperature_f numeric, p_bp_systolic smallint, p_bp_diastolic smallint, p_pulse smallint, p_spo2 smallint, p_respiratory_rate smallint, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;;

CREATE OR REPLACE FUNCTION public.get_visit_financial_summaries(p_visit_ids uuid[])
 RETURNS TABLE(visit_id uuid, fee_paise bigint, collected_paise bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select v.id, v.fee_paise, coalesce(sum(p.amount_paise),0)::bigint
  from public.visits v
  left join public.visit_payments p on p.visit_id = v.id
  where v.id = any(p_visit_ids)
  group by v.id;
end $function$
;;

CREATE OR REPLACE FUNCTION public.update_patient_allergies(p_patient_id uuid, p_allergies text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_value text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor','reception','op') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(coalesce(p_allergies,'')) > 1000 then
    raise exception 'allergies too long' using errcode='22001';
  end if;

  v_value := nullif(btrim(coalesce(p_allergies,'')),'');
  update public.patients set allergies = v_value, updated_at = now()
  where id = p_patient_id;
  if not found then
    raise exception 'patient not found' using errcode='42704';
  end if;

  -- The value itself is clinical content and stays out of the log; only the
  -- fact that it changed is recorded.
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'PATIENT_UPDATED', 'patient', p_patient_id,
          jsonb_build_object('field','allergies','cleared', v_value is null));
  return coalesce(v_value,'');
end $function$
;;

CREATE OR REPLACE FUNCTION public.list_known_allergies(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(allergy text, patient_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_query text;
begin
  v_role := public.current_app_role();
  -- Same roles that may read a patient record at all.
  if v_role is null or v_role not in ('admin','reception','op','doctor') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := lower(trim(coalesce(p_query,'')));

  return query
  with entries as (
    -- One row per allergy per patient: the column holds a comma or newline
    -- separated list.
    select btrim(regexp_replace(value, '\s+', ' ', 'g')) as label
    from public.patients p,
         lateral regexp_split_to_table(coalesce(p.allergies, ''), '[,;\n]') as value
    where p.status = 'active'
  ),
  cleaned as (
    select label, lower(label) as key
    from entries
    where length(label) between 2 and 80
  )
  select
    -- The most frequently used spelling wins as the display label.
    (array_agg(c.label order by c.label))[1] as allergy,
    count(*) as patient_count
  from cleaned c
  where v_query = '' or c.key like v_query || '%' or c.key like '% ' || v_query || '%'
  group by c.key
  order by count(*) desc, 1
  limit least(greatest(p_limit, 1), 50);
end $function$
;;

CREATE OR REPLACE FUNCTION public.list_medicine_directory(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false)
 RETURNS TABLE(id uuid, brand_name text, generic_name text, strength text, dosage_form text, manufacturer text, active boolean, archived_at timestamp with time zone, available_quantity bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The null check matters: current_app_role() is null for a caller with no
  -- profile row, and `null not in (...)` is null, which falls through the
  -- guard rather than tripping it.
  if public.current_app_role() is null or public.current_app_role() not in (
    'admin', 'reception', 'pharmacy', 'doctor', 'op'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength,
    medicine.dosage_form,
    medicine.manufacturer,
    medicine.active,
    medicine.archived_at,
    coalesce(sum(batch.quantity) filter (
      where batch.active and batch.expiry_date >= current_date
    ), 0)::bigint,
    count(*) over()
  from public.medicine_directory medicine
  left join public.medicine_batches batch on batch.medicine_id = medicine.id
  -- Two disjoint views of one table: the library, and what was removed from
  -- it. Nothing outside the removed view ever sees an archived medicine.
  where (
      case
        when p_include_archived then medicine.archived_at is not null
        else medicine.archived_at is null
      end
    )
    and (
      nullif(trim(p_query), '') is null
      or medicine.search_text like '%' || lower(trim(p_query)) || '%'
    )
  group by medicine.id
  order by medicine.brand_name
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$function$
;;

CREATE OR REPLACE FUNCTION public.cache_who_icd10_term(p_display_text text, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_role() not in ('admin','doctor','op') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(trim(coalesce(p_display_text,''))) < 2 or length(trim(coalesce(p_code,''))) < 1 then
    return;
  end if;

  insert into public.clinical_terms(term_type, display_text, code, code_system, source, source_license)
  values ('diagnosis', trim(p_display_text), trim(p_code), 'ICD-10', 'WHO ICD-API', 'WHO ICD-10 public')
  on conflict (term_type, normalized_text) do update
    set code = coalesce(public.clinical_terms.code, excluded.code),
        code_system = coalesce(public.clinical_terms.code_system, excluded.code_system);
end $function$
;;

CREATE OR REPLACE FUNCTION public.list_patients(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_visit_count boolean DEFAULT false, p_active_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, name text, uhid text, phone_normalized text, dob date, gender text, status text, created_at timestamp with time zone, visit_count bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_query text;
  v_digits text;
  v_uhid_query text;
  v_limit integer;
  v_offset integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','reception','op','doctor','pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  v_uhid_query := case
    when v_query ~ '^mh-?[0-9]+' then 'mh-' || v_digits
    else v_query
  end;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := least(greatest(coalesce(p_offset, 0), 0), 100000);

  return query
  with filtered as (
    select
      p.id,
      p.name,
      p.uhid,
      p.phone_normalized,
      p.dob,
      p.gender::text as gender,
      p.status::text as status,
      p.created_at,
      p.name_normalized,
      count(*) over () as total_count,
      case
        when v_query = '' then 0
        when lower(p.uhid) = v_uhid_query then 0
        when p.phone_normalized = right(v_digits, 10) then 0
        when p.phone_normalized like right(v_digits, 10) || '%' then 1
        when lower(p.uhid) like 'mh-' || v_digits || '%' then 2
        else 3
      end as relevance
    from public.patients p
    where
      (not p_active_only or p.status = 'active')
      and (
        v_query = ''
        or (
          v_query ~ '^mh-?[0-9]+'
          and lower(p.uhid) like v_uhid_query || '%'
        )
        or (
          v_query ~ '^[0-9+() -]+$'
          and v_digits <> ''
          and (
            p.phone_normalized like right(v_digits, 10) || '%'
            or lower(p.uhid) like 'mh-' || v_digits || '%'
          )
        )
        or (
          v_query !~ '^[0-9+() -]+$'
          and v_query !~ '^mh-?[0-9]+'
          and p.name_normalized like v_query || '%'
        )
      )
  ), paged as (
    select f.*
    from filtered f
    order by
      f.relevance,
      case when v_query = '' then f.created_at end desc,
      f.name_normalized,
      f.id
    limit v_limit
    offset v_offset
  )
  select
    p.id,
    p.name,
    p.uhid,
    p.phone_normalized,
    p.dob,
    p.gender,
    p.status,
    p.created_at,
    coalesce(v.visit_count, 0)::bigint,
    p.total_count
  from paged p
  left join lateral (
    select count(*)::bigint as visit_count
    from public.visits visit
    where p_include_visit_count and visit.patient_id = p.id
  ) v on true
  order by
    p.relevance,
    case when v_query = '' then p.created_at end desc,
    p.name_normalized,
    p.id;
end
$function$
;;

CREATE OR REPLACE FUNCTION public.search_medicine_availability(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, brand_name text, generic_name text, strength text, dosage_form text, quantity bigint, low_stock_threshold bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in (
    'admin', 'reception', 'doctor', 'op', 'pharmacy'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := lower(trim(p_query));
  if v_query = '' then return; end if;
  return query
  select
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength,
    medicine.dosage_form,
    coalesce(sum(batch.quantity) filter (
      where batch.active and batch.expiry_date >= current_date
    ), 0)::bigint,
    coalesce(sum(batch.low_stock_threshold) filter (
      where batch.active
    ), 0)::bigint
  from public.medicine_directory medicine
  left join public.medicine_batches batch on batch.medicine_id = medicine.id
  where medicine.active
    and (
      medicine.search_text like v_query || '%'
      or medicine.search_text like '% ' || v_query || '%'
    )
  group by medicine.id
  order by
    case
      when lower(medicine.brand_name) = v_query then 0
      when medicine.search_text like v_query || '%' then 1
      when lower(coalesce(medicine.generic_name, '')) like v_query || '%' then 2
      else 3
    end,
    medicine.brand_name
  limit least(greatest(p_limit, 1), 25);
end;
$function$
;;

CREATE OR REPLACE FUNCTION public.search_clinical_terms(p_term_type text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, term_type text, display_text text, code text, code_system text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_query text;
begin
  if public.current_app_role() not in (
    'admin', 'reception', 'doctor', 'op', 'pharmacy'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := nullif(lower(regexp_replace(
    trim(coalesce(p_query, '')), '\s+', ' ', 'g'
  )), '');

  return query
  select
    term.id,
    term.term_type,
    term.display_text,
    term.code,
    term.code_system
  from public.clinical_terms term
  where term.active
    and term.term_type = p_term_type
    and (
      v_query is null
      or term.normalized_text like v_query || '%'
      or term.normalized_text like '% ' || v_query || '%'
      or lower(coalesce(term.code, '')) like v_query || '%'
      or exists (
        select 1
        from unnest(term.search_aliases) alias
        where lower(alias) like v_query || '%'
      )
    )
  order by
    case when term.normalized_text like v_query || '%' then 0 else 1 end,
    term.display_text
  limit least(greatest(coalesce(p_limit, 20), 1), 25);
end;
$function$
;;

-- The `ip` role no longer exists in the app; no profile may hold it.
update public.profiles set status = 'inactive', role = 'reception' where role = 'ip';
alter table public.profiles add constraint profiles_role_not_ip check (role <> 'ip');

-- Signatures that changed above start without API grants; re-grant them to
-- signed-in staff only (each routine enforces its own role guard).
revoke execute on function
  public.list_doctor_workload(),
  public.get_procedure_bill_receipt(uuid),
  public.list_procedure_sales(text, integer, integer),
  public.list_pending_prescriptions(text, integer, text, integer),
  public.save_visit_consultation(uuid, text, text, text, text, text, public.follow_up_type, date, integer, jsonb, jsonb, boolean, bigint, jsonb),
  public.report_staff_activity(date, date)
from public, anon;
grant execute on function
  public.list_doctor_workload(),
  public.get_procedure_bill_receipt(uuid),
  public.list_procedure_sales(text, integer, integer),
  public.list_pending_prescriptions(text, integer, text, integer),
  public.save_visit_consultation(uuid, text, text, text, text, text, public.follow_up_type, date, integer, jsonb, jsonb, boolean, bigint, jsonb),
  public.report_staff_activity(date, date)
to authenticated;
