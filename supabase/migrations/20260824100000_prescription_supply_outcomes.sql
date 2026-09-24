-- Pharmacy supplies only what the consultant prescribed. A shortage may be
-- closed as unavailable without inventing a zero-value sale or stock movement.

alter type public.prescription_status add value if not exists 'unavailable';

commit;
begin;

create or replace function public.protect_prescription_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('dispensed', 'cancelled', 'expired', 'unavailable')
     and new.status <> old.status then
    raise exception 'closed prescription is immutable';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'prescription cannot return to draft';
  end if;
  if public.current_app_role() = 'doctor'
     and old.status <> 'draft'
     and new.status <> old.status then
    raise exception 'completed prescription lifecycle is controlled by pharmacy';
  end if;
  return new;
end;
$$;

-- One normal dispense transaction: exact batch depletion, exact pack-price
-- arithmetic, a single sale, and (for OP) the exact trusted outstanding visit
-- fee. The client cannot increase requested_quantity at the counter.
create or replace function public.dispense_prescription(
  p_prescription_id uuid,
  p_lines jsonb,
  p_payment_mode public.payment_mode,
  p_idempotency_key uuid,
  p_consultation_collected_paise bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_sale_id uuid;
  v_patient_id uuid;
  v_ip_ticket_id uuid;
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
    p.ip_ticket_id,
    p.visit_id,
    case when p.ip_ticket_id is null
      then 'op'::public.sale_source else 'ip'::public.sale_source end
  into v_patient_id, v_ip_ticket_id, v_visit_id, v_source
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  where p.id = p_prescription_id
    and p.status in ('pending', 'partially_dispensed')
    and p.created_at > now() - interval '24 hours'
  for update of p;

  if not found or v_patient_id is null then
    select i.patient_id, p.ip_ticket_id, null::uuid, 'ip'::public.sale_source
    into v_patient_id, v_ip_ticket_id, v_visit_id, v_source
    from public.prescriptions p
    join public.ip_tickets i on i.id = p.ip_ticket_id
    where p.id = p_prescription_id
      and p.status in ('pending', 'partially_dispensed')
      and p.created_at > now() - interval '24 hours'
    for update of p;
  end if;
  if v_patient_id is null then
    raise exception 'prescription expired or unavailable' using errcode = '23514';
  end if;

  -- Collection is not an editable selling price. The consultation form may
  -- save an authorized fee override; dispensing collects that visit's exact
  -- current outstanding value, never a client-selected amount.
  if v_source = 'op' then
    select greatest(0, v.fee_paise - coalesce(sum(vp.amount_paise), 0))
    into v_outstanding
    from public.visits v
    left join public.visit_payments vp on vp.visit_id = v.id
    where v.id = v_visit_id
    group by v.fee_paise;
    if coalesce(p_consultation_collected_paise, 0) <> coalesce(v_outstanding, 0) then
      raise exception 'exact outstanding consultation fee required' using errcode = '23514';
    end if;
  elsif coalesce(p_consultation_collected_paise, 0) <> 0 then
    raise exception 'IP consultation is billed on the ticket' using errcode = '23514';
  end if;

  insert into public.pharmacy_sales(
    prescription_id, patient_id, source, ip_ticket_id, payment_mode, idempotency_key
  ) values (
    p_prescription_id, v_patient_id, v_source, v_ip_ticket_id,
    case when v_source = 'op' then p_payment_mode else null end,
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
    if not found
       or v_item.dispensed_quantity + v_qty > v_item.requested_quantity then
      raise exception 'quantity exceeds pending prescription' using errcode = '23514';
    end if;

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
    update public.prescription_items
    set dispensed_quantity = dispensed_quantity + v_qty
    where id = v_item.id;

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
    insert into public.stock_movements(
      batch_id, quantity_delta, reason, idempotency_key
    ) values (
      v_batch.id, -v_qty, 'Prescription dispense', v_sale_item_id
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

  if v_source = 'ip' then
    insert into public.ip_charges(
      ip_ticket_id, category, item, quantity, rate_paise,
      source_type, source_id, idempotency_key
    ) values (
      v_ip_ticket_id, 'pharmacy', 'Pharmacy medicines', 1, v_total,
      'pharmacy_sale', v_sale_id, p_idempotency_key
    );
  elsif v_outstanding > 0 then
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
$$;

revoke all on function public.dispense_prescription(
  uuid, jsonb, public.payment_mode, uuid, bigint
) from public, anon;
grant execute on function public.dispense_prescription(
  uuid, jsonb, public.payment_mode, uuid, bigint
) to authenticated, service_role;

create or replace function public.mark_prescription_unavailable(
  p_prescription_id uuid,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_status public.prescription_status;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '23514';
  end if;

  -- A retry with the same key is a successful no-op.
  if exists(
    select 1 from public.audit_logs
    where action = 'PRESCRIPTION_UNAVAILABLE'
      and entity_id = p_prescription_id
      and metadata ->> 'idempotency_key' = p_idempotency_key::text
  ) then
    return p_prescription_id;
  end if;

  select status into v_status
  from public.prescriptions
  where id = p_prescription_id
  for update;
  if not found then
    raise exception 'prescription unavailable' using errcode = '23514';
  end if;
  if v_status = 'unavailable' and exists(
    select 1 from public.audit_logs
    where action = 'PRESCRIPTION_UNAVAILABLE'
      and entity_id = p_prescription_id
      and metadata ->> 'idempotency_key' = p_idempotency_key::text
  ) then
    return p_prescription_id;
  end if;
  if v_status not in ('pending', 'partially_dispensed') then
    raise exception 'prescription unavailable' using errcode = '23514';
  end if;
  if not exists(
    select 1 from public.prescription_items
    where prescription_id = p_prescription_id
      and dispensed_quantity < requested_quantity
  ) then
    raise exception 'no remaining quantity' using errcode = '23514';
  end if;

  update public.prescriptions
  set status = 'unavailable'::public.prescription_status
  where id = p_prescription_id;
  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'PRESCRIPTION_UNAVAILABLE', 'prescription', p_prescription_id,
    jsonb_build_object('idempotency_key', p_idempotency_key::text)
  );
  return p_prescription_id;
end;
$$;

revoke all on function public.mark_prescription_unavailable(uuid, uuid)
from public, anon;
grant execute on function public.mark_prescription_unavailable(uuid, uuid)
to authenticated, service_role;

-- Completed includes prescriptions the hospital could not fully supply.
create or replace function public.list_pending_prescriptions(
  p_query text default null,
  p_limit integer default 50,
  p_status_filter text default 'pending'
)
returns table(
  id uuid, prescription_number bigint, status text, created_at timestamptz,
  expires_at timestamptz, visit_id uuid, ip_ticket_id uuid,
  token_number integer, source text, patient_name text, patient_phone text,
  doctor_name text, consultation_fee_paise bigint,
  consultation_balance_paise bigint, items jsonb, latest_sale_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
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
    (p.created_at + interval '24 hours'), p.visit_id, p.ip_ticket_id,
    v.token_number,
    case when p.ip_ticket_id is not null then 'IP' else 'OP' end,
    coalesce(vp.name, ip.name),
    coalesce(vp.phone_normalized, ip.phone_normalized), d.display_name,
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
      where s.prescription_id = p.id order by s.created_at desc limit 1)
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  left join public.patients vp on vp.id = v.patient_id
  left join public.ip_tickets t on t.id = p.ip_ticket_id
  left join public.patients ip on ip.id = t.patient_id
  left join public.doctors d on d.id = p.doctor_id
  where (
    p.status = any(v_statuses)
    or (p_status_filter = 'pending' and p.status = 'dispensed'
        and p.updated_at > now() - interval '10 minutes')
  )
    and (
      v_query is null
      or coalesce(vp.name, ip.name) ilike '%' || v_query || '%'
      or coalesce(vp.phone_normalized, ip.phone_normalized) like v_query || '%'
      or v.token_number::text = v_query
      or p.prescription_number::text = regexp_replace(v_query, '\D', '', 'g')
    )
  order by
    case when p_status_filter = 'pending' then v.token_number end nulls last,
    case when p_status_filter <> 'pending' then p.created_at end desc,
    p.created_at
  limit least(greatest(p_limit, 1), 200);
end;
$$;

revoke all on function public.list_pending_prescriptions(text, integer, text)
from public, anon;
grant execute on function public.list_pending_prescriptions(text, integer, text)
to authenticated, service_role;

-- Keep the patient identity available to pharmacy for printing the shortage
-- prescription after a no-sale unavailable close.
create or replace function public.pharmacy_may_view_visit(p_visit_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.visits v
    where v.id = p_visit_id and v.status <> 'cancelled'
      and (
        not exists(select 1 from public.consultations c
          where c.visit_id = v.id and c.status = 'completed')
        or exists(select 1 from public.prescriptions p
          where p.visit_id = v.id
            and p.status in ('pending', 'partially_dispensed', 'unavailable'))
        or exists(select 1 from public.prescriptions p
          join public.pharmacy_sales s on s.prescription_id = p.id
          where p.visit_id = v.id)
      )
  );
$$;

create or replace function public.pharmacy_may_view_ip_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.ip_tickets t
    where t.id = p_ticket_id
      and (
        exists(select 1 from public.prescriptions p
          where p.ip_ticket_id = t.id
            and (p.status in ('pending', 'partially_dispensed', 'unavailable')
              or exists(select 1 from public.pharmacy_sales s
                where s.prescription_id = p.id)))
        or exists(select 1 from public.ip_inventory_requests r
          where r.ip_ticket_id = t.id)
      )
  );
$$;

commit;
