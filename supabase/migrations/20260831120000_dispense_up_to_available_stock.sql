-- The pharmacy counter may supply more than was prescribed when the batch has
-- the stock for it: "Dispense now" is bounded by available stock, not by the
-- prescribed quantity. dispense_prescription() previously rejected that with
-- 'quantity exceeds pending prescription', and prescription_items carries a
-- dispensed_quantity <= requested_quantity check, so the excess is absorbed by
-- raising requested_quantity in the same statement that records the supply.
-- protect_prescription_content() (20260819140000) already allows that column to
-- rise and never to fall, so the consultant's quantity still cannot be shrunk
-- at the counter, and every raise lands in audit_logs.
--
-- What stays enforced: a client-supplied 'new_requested_quantity' is still
-- rejected -- the quantity on record follows what was actually handed over, it
-- is never an independently editable field at the counter.

begin;

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

commit;
