begin;

-- An IP item fulfilment has exactly one financial destination.  Historical
-- rows that used an offsetting IP payment remain intact, but new pharmacy
-- counter collections must not also become an IP bill charge/payment pair.
alter table public.ip_inventory_requests
  add column if not exists settlement text not null default 'ip_ticket',
  add column if not exists counter_collected_paise bigint,
  add column if not exists counter_payment_mode public.payment_mode,
  add column if not exists counter_reference text,
  add column if not exists counter_collected_at timestamptz,
  add column if not exists counter_collected_by uuid
    references public.profiles(id) on delete restrict;

-- Old fulfilled requests with a linked IP payment used the former
-- "charge + offsetting IP payment" model.  Keep them readable without
-- reclassifying or mutating their financial history.
update public.ip_inventory_requests
set settlement = 'legacy_ip_payment'
where payment_id is not null
  and settlement = 'ip_ticket';

alter table public.ip_inventory_requests
  drop constraint if exists ip_inventory_requests_settlement_valid;
alter table public.ip_inventory_requests
  add constraint ip_inventory_requests_settlement_valid
  check (settlement in ('ip_ticket', 'pharmacy_counter', 'legacy_ip_payment'));

alter table public.ip_inventory_requests
  drop constraint if exists ip_inventory_requests_counter_settlement_consistent;
alter table public.ip_inventory_requests
  add constraint ip_inventory_requests_counter_settlement_consistent
  check (
    (
      settlement = 'pharmacy_counter'
      and payment_id is null
      and counter_collected_paise is not null
      and counter_collected_paise > 0
      and counter_payment_mode is not null
      and counter_collected_at is not null
      and counter_collected_by is not null
    )
    or (
      settlement = 'ip_ticket'
      and payment_id is null
      and counter_collected_paise is null
      and counter_payment_mode is null
      and counter_reference is null
      and counter_collected_at is null
      and counter_collected_by is null
    )
    or (
      settlement = 'legacy_ip_payment'
      and payment_id is not null
      and counter_collected_paise is null
      and counter_payment_mode is null
      and counter_reference is null
      and counter_collected_at is null
      and counter_collected_by is null
    )
  ) not valid;

create index if not exists ip_inventory_requests_counter_collection_day_idx
  on public.ip_inventory_requests (
    ((counter_collected_at at time zone 'Asia/Kolkata')::date)
  )
  where settlement = 'pharmacy_counter';

-- Request outcomes are clinical; their prices and counter-payment details
-- are finance data. Keep the safe request/quantity columns available to the
-- IP team and doctors, while guarded RPCs supply financial data only to the
-- staff permitted to see it.
revoke select on public.ip_inventory_requests from authenticated;
grant select(
  id, ip_ticket_id, requested_by, notes, status, settlement, created_at,
  fulfilled_at, fulfilled_by
) on public.ip_inventory_requests to authenticated;

revoke select on public.ip_inventory_request_items from authenticated;
grant select(
  id, request_id, requested_name, inventory_item_id, medicine_id,
  requested_quantity, fulfilled_quantity, status, created_at
) on public.ip_inventory_request_items to authenticated;

-- A doctor can see supply outcomes only for their own admitted patient. The
-- prior role-only policy exposed every ward's request rows to every doctor.
drop policy if exists ip_inventory_requests_read on public.ip_inventory_requests;
create policy ip_inventory_requests_read
  on public.ip_inventory_requests for select to authenticated
  using (
    (select public.current_app_role())
      in ('admin', 'reception', 'ip')
    or (
      (select public.current_app_role()) = 'doctor'
      and exists (
        select 1
        from public.ip_tickets ticket
        where ticket.id = ip_inventory_requests.ip_ticket_id
          and ticket.doctor_id = (select public.current_doctor_id())
      )
    )
    or (
      (select public.current_app_role()) = 'pharmacy'
      and public.pharmacy_may_view_ip_ticket(ip_inventory_requests.ip_ticket_id)
    )
  );

drop function if exists public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text
);

create function public.fulfill_ip_inventory_request(
  p_request_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_collected_paise bigint default 0,
  p_payment_mode public.payment_mode default null,
  p_reference text default null,
  p_settlement text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.ip_inventory_requests%rowtype;
  v_line jsonb;
  v_item public.ip_inventory_request_items%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_batch public.medicine_batches%rowtype;
  v_qty integer;
  v_price bigint;
  v_inventory_id uuid;
  v_medicine_id uuid;
  v_remaining integer;
  v_take integer;
  v_line_total bigint;
  v_total bigint := 0;
  v_settlement text;
  v_ticket_status public.ip_status;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_collected_paise, 0) < 0 then
    raise exception 'invalid collected amount' using errcode = '23514';
  end if;

  -- Older callers did not send a settlement choice.  A positive collection is
  -- unambiguously a pharmacy-counter collection under the corrected rule;
  -- no collection means the value belongs on the IP ticket.
  v_settlement := lower(trim(coalesce(p_settlement, '')));
  if v_settlement = '' then
    v_settlement := case
      when coalesce(p_collected_paise, 0) > 0 then 'pharmacy_counter'
      else 'ip_ticket'
    end;
  end if;
  if v_settlement not in ('ip_ticket', 'pharmacy_counter') then
    raise exception 'invalid settlement destination' using errcode = '23514';
  end if;

  select * into v_request
  from public.ip_inventory_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request unavailable' using errcode = '42501';
  end if;
  if v_request.status = 'fulfilled' then
    if v_request.settlement is distinct from v_settlement
       or (
         v_settlement = 'pharmacy_counter'
         and (
           coalesce(v_request.counter_collected_paise, 0)
             <> coalesce(p_collected_paise, 0)
           or v_request.counter_payment_mode is distinct from p_payment_mode
           or coalesce(v_request.counter_reference, '') is distinct from
             coalesce(nullif(trim(coalesce(p_reference, '')), ''), '')
         )
       )
       or (
         v_settlement = 'ip_ticket'
         and coalesce(p_collected_paise, 0) <> 0
       )
    then
      raise exception 'request was already fulfilled with a different settlement'
        using errcode = '23514';
    end if;
    return p_request_id;
  end if;

  select status into v_ticket_status
  from public.ip_tickets
  where id = v_request.ip_ticket_id
  for update;
  if not found then
    raise exception 'IP ticket unavailable' using errcode = '42501';
  end if;
  -- A pharmacy-counter collection remains separate from the IP ledger, but
  -- anything billed to the ticket must be settled before its final bill is
  -- closed. This prevents a late fulfilment from changing a discharged bill.
  if v_settlement = 'ip_ticket'
     and v_ticket_status not in ('admitted', 'discharge_pending') then
    raise exception 'IP ticket is not active' using errcode = '23514';
  end if;

  for v_line in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    select * into v_item
    from public.ip_inventory_request_items
    where id = (v_line ->> 'request_item_id')::uuid
      and request_id = p_request_id
      and status = 'pending'
    for update;
    if not found then
      continue;
    end if;

    v_qty := coalesce((v_line ->> 'fulfilled_quantity')::integer, 0);
    if v_qty < 0 or v_qty > v_item.requested_quantity then
      raise exception 'invalid fulfilled quantity' using errcode = '23514';
    end if;
    if v_qty = 0 then
      update public.ip_inventory_request_items
      set status = 'unavailable', amount_paise = 0
      where id = v_item.id;
      continue;
    end if;

    v_inventory_id := nullif(v_line ->> 'inventory_item_id', '')::uuid;
    v_medicine_id := nullif(v_line ->> 'medicine_id', '')::uuid;
    if v_inventory_id is not null and v_medicine_id is not null then
      raise exception 'choose one stock source' using errcode = '23514';
    end if;

    v_line_total := 0;
    if v_inventory_id is not null then
      select * into v_inventory
      from public.inventory_items
      where id = v_inventory_id
        and active
        and (expiry_date is null or expiry_date >= current_date)
      for update;
      if not found or v_inventory.quantity < v_qty then
        raise exception 'insufficient inventory stock for %',
          coalesce(v_inventory.name, v_item.requested_name)
          using errcode = '23514';
      end if;
      v_price := v_inventory.selling_price_paise;
      v_line_total := v_qty * v_price;
      update public.inventory_items
      set quantity = quantity - v_qty, updated_at = now()
      where id = v_inventory.id;

    elsif v_medicine_id is not null then
      if not exists (
        select 1
        from public.medicine_directory medicine
        where medicine.id = v_medicine_id and medicine.active
      ) then
        raise exception 'medicine unavailable' using errcode = '23514';
      end if;
      v_remaining := v_qty;
      for v_batch in
        select batch.*
        from public.medicine_batches batch
        where batch.medicine_id = v_medicine_id
          and batch.active and batch.quantity > 0
          and batch.expiry_date >= current_date
        order by batch.expiry_date, batch.id
        for update
      loop
        exit when v_remaining = 0;
        v_take := least(v_remaining, v_batch.quantity);
        v_line_total := v_line_total + round(
          v_take::numeric * v_batch.selling_price_paise
          / greatest(v_batch.units_per_pack, 1)
        )::bigint;
        update public.medicine_batches
        set quantity = quantity - v_take, updated_at = now()
        where id = v_batch.id;
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        raise exception 'insufficient medicine stock for %',
          v_item.requested_name using errcode = '23514';
      end if;
      v_price := round(v_line_total::numeric / v_qty)::bigint;
    else
      v_price := (v_line ->> 'unit_price_paise')::bigint;
      if v_price is null or v_price <= 0 then
        raise exception 'manual unit price is required for off-catalog item %',
          v_item.requested_name using errcode = '23514';
      end if;
      v_line_total := v_qty * v_price;
    end if;

    update public.ip_inventory_request_items
    set fulfilled_quantity = v_qty,
        unit_price_paise = v_price,
        amount_paise = v_line_total,
        inventory_item_id = v_inventory_id,
        medicine_id = v_medicine_id,
        status = 'fulfilled'
    where id = v_item.id;
    v_total := v_total + v_line_total;
  end loop;

  -- The requested quantity remains intact for the record.  Only supplied
  -- quantity is charged or collected; every unsupplied line is explicitly
  -- retained as unavailable for the outside-purchase note.
  update public.ip_inventory_request_items
  set status = 'unavailable', amount_paise = 0
  where request_id = p_request_id and status = 'pending';

  if v_settlement = 'pharmacy_counter' then
    if v_total <= 0 then
      raise exception 'no supplied items are available to collect'
        using errcode = '23514';
    end if;
    if coalesce(p_collected_paise, 0) <> v_total then
      raise exception 'pharmacy counter collection must equal supplied items total'
        using errcode = '23514';
    end if;
    if p_payment_mode is null then
      raise exception 'payment mode is required' using errcode = '23514';
    end if;
  elsif coalesce(p_collected_paise, 0) <> 0 then
    raise exception 'IP-ticket billing cannot collect at the pharmacy counter'
      using errcode = '23514';
  end if;

  if v_settlement = 'ip_ticket' and v_total > 0 then
    insert into public.ip_charges(
      ip_ticket_id, category, item, quantity, rate_paise,
      source_type, source_id, idempotency_key
    )
    values(
      v_request.ip_ticket_id, 'pharmacy',
      'Pharmacy items · ' || (
        select count(*) from public.ip_inventory_request_items
        where request_id = p_request_id and status = 'fulfilled'
      ) || ' item(s)',
      1, v_total, 'ip_inventory_request', p_request_id, p_idempotency_key
    )
    on conflict (source_type, source_id)
      where source_type is not null and source_id is not null
      do nothing;
  end if;

  update public.ip_inventory_requests
  set status = 'fulfilled',
      fulfilled_at = now(),
      fulfilled_by = auth.uid(),
      payment_id = null,
      settlement = v_settlement,
      counter_collected_paise = case
        when v_settlement = 'pharmacy_counter' then v_total else null
      end,
      counter_payment_mode = case
        when v_settlement = 'pharmacy_counter' then p_payment_mode else null
      end,
      counter_reference = case
        when v_settlement = 'pharmacy_counter'
          then nullif(trim(coalesce(p_reference, '')), '')
        else null
      end,
      counter_collected_at = case
        when v_settlement = 'pharmacy_counter' then now() else null
      end,
      counter_collected_by = case
        when v_settlement = 'pharmacy_counter' then auth.uid() else null
      end
  where id = p_request_id;

  if v_settlement = 'pharmacy_counter' then
    insert into public.audit_logs(
      actor_user_id, action, entity_type, entity_id, metadata
    )
    values(
      auth.uid(), 'PHARMACY_COUNTER_COLLECTION_RECORDED',
      'ip_inventory_request', p_request_id,
      jsonb_build_object(
        'amount_paise', v_total,
        'payment_mode', p_payment_mode,
        'ip_ticket_id', v_request.ip_ticket_id
      )
    );
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values(
    auth.uid(), 'IP_INVENTORY_FULFILLED', 'ip_inventory_request',
    p_request_id,
    jsonb_build_object(
      'total_paise', v_total,
      'settlement', v_settlement,
      'counter_collected_paise', case
        when v_settlement = 'pharmacy_counter' then v_total else 0
      end
    )
  );
  return p_request_id;
end
$$;

revoke all on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) to authenticated, service_role;

drop function if exists public.list_ip_inventory_requests(text, text, integer, integer);
create function public.list_ip_inventory_requests(
  p_view text default 'pending',
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  request_id uuid,
  ip_ticket_id uuid,
  ticket_number text,
  patient_name text,
  item_count bigint,
  notes text,
  status text,
  settlement text,
  created_at timestamptz,
  fulfilled_at timestamptz,
  total_paise bigint,
  collected_paise bigint,
  shortfall_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text;
  v_view text;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := nullif(trim(coalesce(p_query, '')), '');
  v_view := case when p_view = 'completed' then 'completed' else 'pending' end;

  return query
  with requests as (
    select
      request.id as request_id,
      request.ip_ticket_id,
      ticket.ticket_number,
      coalesce(patient.name, 'Unidentified emergency')::text as patient_name,
      count(item.id)::bigint as item_count,
      request.notes,
      request.status::text,
      request.settlement::text,
      request.created_at,
      request.fulfilled_at,
      coalesce(sum(item.amount_paise) filter (
        where item.status = 'fulfilled'
      ), 0)::bigint as total_paise,
      case
        when request.settlement = 'pharmacy_counter'
          then coalesce(request.counter_collected_paise, 0)
        else coalesce(payment.amount_paise, 0)
      end::bigint as collected_paise,
      count(item.id) filter (
        where item.requested_quantity > item.fulfilled_quantity
      )::bigint as shortfall_count
    from public.ip_inventory_requests request
    join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
    left join public.patients patient on patient.id = ticket.patient_id
    join public.ip_inventory_request_items item
      on item.request_id = request.id
    left join public.ip_payments payment on payment.id = request.payment_id
    where (
      (v_view = 'pending' and (
        request.status = 'pending'
        or (
          request.status = 'fulfilled'
          and request.fulfilled_at > now() - interval '10 minutes'
        )
      ))
      or (
        v_view = 'completed'
        and request.status = 'fulfilled'
        and request.fulfilled_at <= now() - interval '10 minutes'
      )
    )
      and (
        v_query is null
        or ticket.ticket_number ilike '%' || v_query || '%'
        or patient.name ilike '%' || v_query || '%'
      )
    group by
      request.id, request.ip_ticket_id, ticket.ticket_number, patient.name,
      request.notes, request.status, request.settlement, request.created_at,
      request.fulfilled_at, request.counter_collected_paise,
      payment.amount_paise
  )
  select
    requests.request_id, requests.ip_ticket_id, requests.ticket_number,
    requests.patient_name, requests.item_count, requests.notes,
    requests.status, requests.settlement, requests.created_at,
    requests.fulfilled_at, requests.total_paise, requests.collected_paise,
    requests.shortfall_count, count(*) over () as total_count
  from requests
  order by
    case when requests.status = 'pending' then 0 else 1 end,
    coalesce(requests.fulfilled_at, requests.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end
$$;

revoke all on function public.list_ip_inventory_requests(
  text, text, integer, integer
) from public, anon;
grant execute on function public.list_ip_inventory_requests(
  text, text, integer, integer
) to authenticated, service_role;

drop function if exists public.get_ip_inventory_request_receipt(uuid);
create function public.get_ip_inventory_request_receipt(
  p_request_id uuid
)
returns table(
  request_id uuid,
  created_at timestamptz,
  fulfilled_at timestamptz,
  ticket_number text,
  patient_name text,
  patient_uhid text,
  total_paise bigint,
  collected_paise bigint,
  settlement text,
  payment_mode text,
  payment_reference text,
  fulfilled_by text,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is null
     or public.current_app_role()
        not in ('admin', 'reception', 'ip', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    request.id,
    request.created_at,
    request.fulfilled_at,
    ticket.ticket_number,
    coalesce(patient.name, 'Unidentified emergency')::text,
    patient.uhid,
    lines.total_paise,
    case
      when request.settlement = 'pharmacy_counter'
        then coalesce(request.counter_collected_paise, 0)
      else coalesce(payment.amount_paise, 0)
    end::bigint,
    request.settlement::text,
    case
      when request.settlement = 'pharmacy_counter'
        then request.counter_payment_mode::text
      else payment.mode::text
    end,
    case
      when request.settlement = 'pharmacy_counter'
        then request.counter_reference
      else payment.reference
    end,
    profile.full_name,
    lines.items
  from public.ip_inventory_requests request
  join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
  left join public.patients patient on patient.id = ticket.patient_id
  left join public.ip_payments payment on payment.id = request.payment_id
  left join public.profiles profile on profile.id = request.fulfilled_by
  cross join lateral (
    select
      coalesce(sum(item.amount_paise), 0)::bigint as total_paise,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'name', item.requested_name,
          'requested_quantity', item.requested_quantity,
          'supplied_quantity', item.fulfilled_quantity,
          'not_supplied_quantity', greatest(
            0, item.requested_quantity - item.fulfilled_quantity
          ),
          'unit_price_paise', item.unit_price_paise,
          'amount_paise', item.amount_paise,
          'outcome', case
            when item.status = 'unavailable' then 'Unavailable — outside purchase'
            when item.fulfilled_quantity < item.requested_quantity
              then 'Partially supplied'
            else 'Supplied'
          end,
          'source', case
            when item.status = 'unavailable' then 'Not supplied'
            when item.medicine_id is not null then 'Medicine'
            when item.inventory_item_id is not null then 'Inventory'
            else 'Manual'
          end
        ) order by item.created_at, item.id
      ), '[]'::jsonb) as items
    from public.ip_inventory_request_items item
    where item.request_id = request.id
  ) lines
  where request.id = p_request_id
    and request.status = 'fulfilled';
end
$$;

revoke all on function public.get_ip_inventory_request_receipt(uuid)
from public, anon;
grant execute on function public.get_ip_inventory_request_receipt(uuid)
to authenticated, service_role;

-- Keep the pharmacy sales ledger useful for both settlement choices.  The
-- direct-counter path is a pharmacy collection; the ticket path remains a
-- dispense record that is payable only through the IP bill.
create or replace function public.list_pharmacy_sales(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  created_at timestamptz,
  source text,
  total_paise bigint,
  patient_name text,
  patient_phone text,
  dispensed_by text,
  item_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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

    union all

    select
      request.id,
      request.fulfilled_at as created_at,
      case
        when request.settlement = 'pharmacy_counter'
          then 'ip_items_collected'
        when coalesce(payment.amount_paise, 0) >= lines.total_paise
          and lines.total_paise > 0 then 'ip_items_legacy_collected'
        when coalesce(payment.amount_paise, 0) > 0 then 'ip_items_partial'
        else 'ip_items'
      end::text as source,
      lines.total_paise,
      patient.name::text as patient_name,
      patient.phone_normalized::text as patient_phone,
      profile.full_name::text as dispensed_by,
      lines.item_count
    from public.ip_inventory_requests request
    join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
    left join public.patients patient on patient.id = ticket.patient_id
    left join public.profiles profile on profile.id = request.fulfilled_by
    left join public.ip_payments payment on payment.id = request.payment_id
    cross join lateral (
      select
        coalesce(sum(item.amount_paise), 0)::bigint as total_paise,
        count(*) filter (
          where item.status = 'fulfilled' and item.fulfilled_quantity > 0
        )::bigint as item_count
      from public.ip_inventory_request_items item
      where item.request_id = request.id
        and item.status = 'fulfilled'
    ) lines
    where request.fulfilled_at is not null
      and lines.item_count > 0
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
$$;

revoke all on function public.list_pharmacy_sales(
  text, integer, integer
) from public, anon;
grant execute on function public.list_pharmacy_sales(
  text, integer, integer
) to authenticated, service_role;

-- The hospital-wide collection KPI must treat a direct pharmacy receipt as a
-- pharmacy collection once.  It remains absent from IP collection and IP
-- balance because no IP charge/payment was created for the new workflow.
create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_ip_item_value bigint;
  v_ip_item_dispenses bigint;
  v_counter_collected bigint := 0;
begin
  if public.current_app_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_summary := public.dashboard_summary_internal();

  if v_summary ? 'pharmacy_sales_today_paise'
     or v_summary ? 'dispensed_today'
  then
    select
      coalesce(sum(
        case when item.status = 'fulfilled' then item.amount_paise else 0 end
      ), 0)::bigint,
      count(distinct request.id) filter (
        where item.status = 'fulfilled' and item.fulfilled_quantity > 0
      )::bigint
    into v_ip_item_value, v_ip_item_dispenses
    from public.ip_inventory_requests request
    left join public.ip_inventory_request_items item
      on item.request_id = request.id
    where request.fulfilled_at is not null
      and (request.fulfilled_at at time zone 'Asia/Kolkata')::date =
          (now() at time zone 'Asia/Kolkata')::date;
  end if;

  if v_summary ? 'pharmacy_sales_today_paise' then
    v_summary := jsonb_set(
      v_summary,
      '{pharmacy_sales_today_paise}',
      to_jsonb(
        coalesce((v_summary ->> 'pharmacy_sales_today_paise')::bigint, 0)
        + coalesce(v_ip_item_value, 0)
      )
    );
  end if;

  if v_summary ? 'dispensed_today' then
    v_summary := jsonb_set(
      v_summary,
      '{dispensed_today}',
      to_jsonb(
        coalesce((v_summary ->> 'dispensed_today')::bigint, 0)
        + coalesce(v_ip_item_dispenses, 0)
      )
    );
  end if;

  if v_summary ? 'collected_today_paise' then
    select coalesce(sum(request.counter_collected_paise), 0)::bigint
    into v_counter_collected
    from public.ip_inventory_requests request
    where request.settlement = 'pharmacy_counter'
      and (request.counter_collected_at at time zone 'Asia/Kolkata')::date =
          (now() at time zone 'Asia/Kolkata')::date;
    v_summary := jsonb_set(
      v_summary,
      '{collected_today_paise}',
      to_jsonb(
        coalesce((v_summary ->> 'collected_today_paise')::bigint, 0)
        + v_counter_collected
      )
    );
  end if;

  return v_summary;
end
$$;

revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary()
to authenticated, service_role;

-- The collected-today card is a combined cash-received number.  Its drill-down
-- must therefore expose a direct IP pharmacy counter receipt as pharmacy
-- collection, never as an IP payment.  Keep the existing wrapper for every
-- other metric so its established role checks and pharmacy/IP detail logic
-- remain unchanged.
create or replace function public.dashboard_metric_detail_for_role(
  p_metric text,
  p_limit integer default 25
)
returns table(
  primary_text text,
  secondary_text text,
  trailing_text text,
  href text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_limit integer;
begin
  v_role := public.current_app_role();
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);

  if p_metric = 'collected_today_paise' then
    if v_role is null or v_role not in ('admin', 'reception') then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    return query
    with activity as (
      select
        payment.created_at as sort_at,
        patient.name::text as primary_text,
        (
          'OP visit · ' || replace(payment.mode::text, '_', ' ')
        )::text as secondary_text,
        to_char(payment.amount_paise / 100.0, 'FM999999990.00')::text
          as trailing_text,
        ('/visits/' || visit.id)::text as href
      from public.visit_payments payment
      join public.visits visit on visit.id = payment.visit_id
      join public.patients patient on patient.id = visit.patient_id
      where (payment.created_at at time zone 'Asia/Kolkata')::date =
        (now() at time zone 'Asia/Kolkata')::date

      union all

      select
        payment.created_at,
        coalesce(patient.name, 'Unidentified emergency')::text,
        (
          'IP payment · ' || ticket.ticket_number || ' · '
          || replace(payment.mode::text, '_', ' ')
        )::text,
        to_char(payment.amount_paise / 100.0, 'FM999999990.00')::text,
        ('/ip/' || ticket.id)::text
      from public.ip_payments payment
      join public.ip_tickets ticket on ticket.id = payment.ip_ticket_id
      left join public.patients patient on patient.id = ticket.patient_id
      where (payment.created_at at time zone 'Asia/Kolkata')::date =
        (now() at time zone 'Asia/Kolkata')::date

      union all

      select
        sale.created_at,
        coalesce(patient.name, 'Unknown patient')::text,
        (
          'Pharmacy · ' || replace(sale.payment_mode::text, '_', ' ')
        )::text,
        to_char(sale.total_paise / 100.0, 'FM999999990.00')::text,
        ('/print/receipt/' || sale.id)::text
      from public.pharmacy_sales sale
      left join public.patients patient on patient.id = sale.patient_id
      where sale.source = 'op'
        and (sale.created_at at time zone 'Asia/Kolkata')::date =
          (now() at time zone 'Asia/Kolkata')::date

      union all

      select
        request.counter_collected_at,
        coalesce(patient.name, 'Unidentified emergency')::text,
        (
          'Pharmacy counter · ' ||
          replace(request.counter_payment_mode::text, '_', ' ')
        )::text,
        to_char(request.counter_collected_paise / 100.0, 'FM999999990.00')::text,
        ('/print/ip-items/' || request.id)::text
      from public.ip_inventory_requests request
      join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
      left join public.patients patient on patient.id = ticket.patient_id
      where request.settlement = 'pharmacy_counter'
        and (request.counter_collected_at at time zone 'Asia/Kolkata')::date =
          (now() at time zone 'Asia/Kolkata')::date
    )
    select
      activity.primary_text,
      activity.secondary_text,
      activity.trailing_text,
      activity.href
    from activity
    order by activity.sort_at desc
    limit v_limit;
    return;
  end if;

  if v_role = 'reception'
     and p_metric = any(array[
       'patients_seen_today', 'vitals_pending', 'ready', 'completed',
       'reports_pending'
     ])
  then
    return query
    select detail.primary_text, detail.secondary_text, detail.trailing_text,
           detail.href
    from public.dashboard_metric_detail(
      p_metric,
      v_limit
    ) detail;
    return;
  end if;

  return query
  select detail.primary_text, detail.secondary_text, detail.trailing_text,
         detail.href
  from public.dashboard_metric_detail_for_role_before_reception_op_merge(
    p_metric,
    p_limit
  ) detail;
end
$$;

revoke all on function public.dashboard_metric_detail_for_role(text, integer)
from public, anon;
grant execute on function public.dashboard_metric_detail_for_role(text, integer)
to authenticated, service_role;

-- Admin analytics separates IP ticket collections from direct pharmacy
-- collections.  Counter-paid IP items are included only in Pharmacy totals.
create or replace function public.report_admin_overview(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'ip_collected_paise', (
      select coalesce(sum(amount_paise), 0)
      from public.ip_payments
      where created_at >= v_from and created_at < v_to
    ),
    'pharmacy_collected_paise', (
      select coalesce(sum(collection.amount_paise), 0)
      from (
        select sale.total_paise as amount_paise
        from public.pharmacy_sales sale
        where sale.source = 'op'
          and sale.created_at >= v_from and sale.created_at < v_to
        union all
        select request.counter_collected_paise
        from public.ip_inventory_requests request
        where request.settlement = 'pharmacy_counter'
          and request.counter_collected_at >= v_from
          and request.counter_collected_at < v_to
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
        + coalesce((
          select sum(amount_paise) from public.ip_charges
          where created_at < v_to
        ), 0)
        - coalesce((
          select sum(amount_paise) from public.ip_payments
          where created_at < v_to
        ), 0)
      )
    ),
    'current_ip', (
      select count(*) from public.ip_tickets
      where status in ('admitted', 'discharge_pending')
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
          'ip', coalesce(ip.amount, 0),
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
        select (payment.created_at at time zone 'Asia/Kolkata')::date as metric_date,
          sum(payment.amount_paise) as amount
        from public.ip_payments payment
        where payment.created_at >= v_from and payment.created_at < v_to
        group by 1
      ) ip on ip.metric_date = day.metric_date
      left join (
        select collection.metric_date, sum(collection.amount_paise) as amount
        from (
          select (sale.created_at at time zone 'Asia/Kolkata')::date as metric_date,
            sale.total_paise as amount_paise
          from public.pharmacy_sales sale
          where sale.source = 'op'
            and sale.created_at >= v_from and sale.created_at < v_to
          union all
          select (request.counter_collected_at at time zone 'Asia/Kolkata')::date,
            request.counter_collected_paise
          from public.ip_inventory_requests request
          where request.settlement = 'pharmacy_counter'
            and request.counter_collected_at >= v_from
            and request.counter_collected_at < v_to
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
    'ip_by_category', (
      select coalesce(jsonb_agg(
        jsonb_build_object('category', category, 'amount_paise', amount)
        order by amount desc
      ), '[]'::jsonb)
      from (
        select category, sum(amount_paise) amount
        from public.ip_charges
        where created_at >= v_from and created_at < v_to
        group by category
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
    'ip_flow_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'date', day.metric_date,
          'admissions', coalesce(admissions.total, 0),
          'discharges', coalesce(discharges.total, 0)
        ) order by day.metric_date
      ), '[]'::jsonb)
      from (
        select generate_series(p_from, p_to, '1 day')::date as metric_date
      ) day
      left join (
        select (admission_at at time zone 'Asia/Kolkata')::date as metric_date,
          count(*) total
        from public.ip_tickets
        where admission_at >= v_from and admission_at < v_to
        group by 1
      ) admissions on admissions.metric_date = day.metric_date
      left join (
        select (discharge_at at time zone 'Asia/Kolkata')::date as metric_date,
          count(*) total
        from public.ip_tickets
        where discharge_at >= v_from and discharge_at < v_to
        group by 1
      ) discharges on discharges.metric_date = day.metric_date
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

          union all

          select
            (request.fulfilled_at at time zone 'Asia/Kolkata')::date,
            coalesce(sum(request_item.amount_paise), 0)::bigint,
            coalesce(sum(request_item.fulfilled_quantity), 0)::bigint
          from public.ip_inventory_requests request
          join public.ip_inventory_request_items request_item
            on request_item.request_id = request.id
          where request.fulfilled_at >= v_from and request.fulfilled_at < v_to
            and request_item.status = 'fulfilled'
          group by request.id, request.fulfilled_at
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
          select payment.mode, payment.amount_paise
          from public.ip_payments payment
          where payment.created_at >= v_from and payment.created_at < v_to
          union all
          select sale.payment_mode, sale.total_paise
          from public.pharmacy_sales sale
          where sale.source = 'op' and sale.payment_mode is not null
            and sale.created_at >= v_from and sale.created_at < v_to
          union all
          select request.counter_payment_mode, request.counter_collected_paise
          from public.ip_inventory_requests request
          where request.settlement = 'pharmacy_counter'
            and request.counter_payment_mode is not null
            and request.counter_collected_at >= v_from
            and request.counter_collected_at < v_to
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
          'source', 'IP',
          'collected_paise', (
            select coalesce(sum(amount_paise), 0)
            from public.ip_payments
            where created_at >= v_from and created_at < v_to
          ),
          'outstanding_paise', greatest(
            0,
            coalesce((
              select sum(amount_paise) from public.ip_charges
              where created_at >= v_from and created_at < v_to
            ), 0)
            - coalesce((
              select sum(amount_paise) from public.ip_payments
              where created_at >= v_from and created_at < v_to
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
              union all
              select request.counter_collected_paise
              from public.ip_inventory_requests request
              where request.settlement = 'pharmacy_counter'
                and request.counter_collected_at >= v_from
                and request.counter_collected_at < v_to
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
$$;

revoke all on function public.report_admin_overview(date, date)
from public, anon;
grant execute on function public.report_admin_overview(date, date)
to authenticated, service_role;

-- IP item requests are a pharmacy supply workflow even when their financial
-- destination is an IP ticket or a direct counter receipt. They do not have a
-- pharmacy_sales row, so include their actual fulfilment work explicitly in
-- the admin's staff-activity report.
create or replace function public.report_staff_activity(
  p_from date,
  p_to date
)
returns table(
  profile_id uuid,
  full_name text,
  role text,
  status text,
  patients_registered bigint,
  visits_created bigint,
  vitals_recorded bigint,
  consultations_completed bigint,
  prescriptions_written bigint,
  tests_ordered bigint,
  reports_uploaded bigint,
  op_payments_count bigint,
  op_payments_paise bigint,
  ip_admissions bigint,
  ip_discharges bigint,
  ip_charges_added bigint,
  ip_charges_paise bigint,
  ip_payments_count bigint,
  ip_payments_paise bigint,
  progress_notes bigint,
  dispenses bigint,
  dispensed_paise bigint,
  stock_movements bigint,
  audited_actions bigint,
  last_action_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if public.current_app_role() is null
     or public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid date range';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  return query
  select
    profile.id,
    profile.full_name,
    profile.role::text,
    profile.status::text,
    (select count(*) from public.patients patient
       where patient.created_by = profile.id
         and patient.created_at >= v_from and patient.created_at < v_to),
    (select count(*) from public.visits visit
       where visit.created_by = profile.id
         and visit.created_at >= v_from and visit.created_at < v_to),
    (select count(*) from public.vitals vital
       where vital.recorded_by = profile.id
         and vital.recorded_at >= v_from and vital.recorded_at < v_to),
    (select count(*) from public.consultations consultation
       where profile.doctor_id is not null
         and consultation.doctor_id = profile.doctor_id
         and consultation.status = 'completed'
         and consultation.completed_at >= v_from
         and consultation.completed_at < v_to),
    (select count(*) from public.prescriptions prescription
       where profile.doctor_id is not null
         and prescription.doctor_id = profile.doctor_id
         and prescription.status <> 'draft'
         and prescription.created_at >= v_from
         and prescription.created_at < v_to),
    (select count(*) from public.test_orders test_order
       where profile.doctor_id is not null
         and test_order.doctor_id = profile.doctor_id
         and test_order.created_at >= v_from and test_order.created_at < v_to),
    (select count(*) from public.patient_reports report
       where report.uploaded_by = profile.id
         and report.created_at >= v_from and report.created_at < v_to),
    (select count(*) from public.visit_payments payment
       where payment.collected_by = profile.id
         and payment.created_at >= v_from and payment.created_at < v_to),
    (select coalesce(sum(payment.amount_paise), 0)::bigint
       from public.visit_payments payment
       where payment.collected_by = profile.id
         and payment.created_at >= v_from and payment.created_at < v_to),
    (select count(*) from public.ip_tickets ticket
       where ticket.created_by = profile.id
         and ticket.created_at >= v_from and ticket.created_at < v_to),
    (select count(*) from public.audit_logs audit
       where audit.actor_user_id = profile.id and audit.action = 'IP_DISCHARGED'
         and audit.created_at >= v_from and audit.created_at < v_to),
    (select count(*) from public.ip_charges charge
       where charge.added_by = profile.id
         and charge.created_at >= v_from and charge.created_at < v_to),
    (select coalesce(sum(charge.amount_paise), 0)::bigint
       from public.ip_charges charge
       where charge.added_by = profile.id
         and charge.created_at >= v_from and charge.created_at < v_to),
    (select count(*) from public.ip_payments payment
       where payment.collected_by = profile.id
         and payment.created_at >= v_from and payment.created_at < v_to),
    (select coalesce(sum(payment.amount_paise), 0)::bigint
       from public.ip_payments payment
       where payment.collected_by = profile.id
         and payment.created_at >= v_from and payment.created_at < v_to),
    (select count(*) from public.ip_progress_notes note
       where profile.doctor_id is not null and note.doctor_id = profile.doctor_id
         and note.created_at >= v_from and note.created_at < v_to),
    (select count(*) from (
       select sale.id
       from public.pharmacy_sales sale
       where sale.dispensed_by = profile.id
         and sale.created_at >= v_from and sale.created_at < v_to
       union all
       select request.id
       from public.ip_inventory_requests request
       where request.fulfilled_by = profile.id
         and request.fulfilled_at >= v_from and request.fulfilled_at < v_to
         and exists (
           select 1
           from public.ip_inventory_request_items request_item
           where request_item.request_id = request.id
             and request_item.status = 'fulfilled'
             and request_item.fulfilled_quantity > 0
         )
    ) dispense),
    (select coalesce(sum(dispense.amount_paise), 0)::bigint from (
       select sale.total_paise as amount_paise
       from public.pharmacy_sales sale
       where sale.dispensed_by = profile.id
         and sale.created_at >= v_from and sale.created_at < v_to
       union all
       select coalesce(sum(request_item.amount_paise), 0)::bigint
       from public.ip_inventory_requests request
       join public.ip_inventory_request_items request_item
         on request_item.request_id = request.id
       where request.fulfilled_by = profile.id
         and request.fulfilled_at >= v_from and request.fulfilled_at < v_to
         and request_item.status = 'fulfilled'
         and request_item.fulfilled_quantity > 0
       group by request.id
    ) dispense),
    (select count(*) from public.stock_movements movement
       where movement.created_by = profile.id
         and movement.created_at >= v_from and movement.created_at < v_to),
    (select count(*) from public.audit_logs audit
       where audit.actor_user_id = profile.id
         and audit.created_at >= v_from and audit.created_at < v_to),
    (select max(audit.created_at) from public.audit_logs audit
       where audit.actor_user_id = profile.id
         and audit.created_at >= v_from and audit.created_at < v_to)
  from public.profiles profile
  order by profile.role, profile.full_name;
end
$$;

revoke all on function public.report_staff_activity(date, date)
from public, anon;
grant execute on function public.report_staff_activity(date, date)
to authenticated, service_role;

commit;
