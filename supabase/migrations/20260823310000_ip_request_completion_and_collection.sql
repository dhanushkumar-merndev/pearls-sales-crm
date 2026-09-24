begin;

alter table public.ip_inventory_request_items
  add column if not exists amount_paise bigint
    check (amount_paise >= 0);
update public.ip_inventory_request_items
set amount_paise = fulfilled_quantity * coalesce(unit_price_paise, 0)
where amount_paise is null;
alter table public.ip_inventory_request_items
  alter column amount_paise set default 0,
  alter column amount_paise set not null;

alter table public.ip_inventory_requests
  add column if not exists payment_id uuid
    references public.ip_payments(id) on delete restrict;

-- Reception can place a request but cannot fulfil it or alter either stock
-- table. The treating doctor remains restricted to their own IP patient.
create or replace function public.create_ip_inventory_request(
  p_ticket_id uuid,
  p_lines jsonb,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_doctor uuid;
  v_ticket public.ip_tickets%rowtype;
  v_request_id uuid;
  v_line jsonb;
  v_name text;
  v_qty integer;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role not in ('admin','reception','ip','doctor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_request_id
  from public.ip_inventory_requests
  where idempotency_key = p_idempotency_key;
  if v_request_id is not null then return v_request_id; end if;

  select * into v_ticket
  from public.ip_tickets
  where id = p_ticket_id
    and status in ('admitted','discharge_pending')
  for update;
  if not found then
    raise exception 'IP ticket unavailable' using errcode = '42501';
  end if;
  if v_role = 'doctor' and v_ticket.doctor_id is distinct from v_doctor then
    raise exception 'doctor may only request items for their own patient'
      using errcode = '42501';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) < 1 then
    raise exception 'at least one item is required' using errcode = '23514';
  end if;

  insert into public.ip_inventory_requests(
    ip_ticket_id, requested_by, notes, idempotency_key
  )
  values(
    p_ticket_id, auth.uid(), nullif(trim(coalesce(p_notes, '')), ''),
    p_idempotency_key
  )
  returning id into v_request_id;

  for v_line in
    select value from jsonb_array_elements(p_lines)
  loop
    v_name := trim(coalesce(v_line ->> 'name', ''));
    v_qty := (v_line ->> 'quantity')::integer;
    if v_name = '' then
      raise exception 'item name is required' using errcode = '23514';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity' using errcode = '23514';
    end if;
    insert into public.ip_inventory_request_items(
      request_id, requested_name, requested_quantity
    )
    values(v_request_id, v_name, v_qty);
  end loop;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values(
    auth.uid(), 'IP_INVENTORY_REQUESTED', 'ip_inventory_request',
    v_request_id, jsonb_build_object('ip_ticket_id', p_ticket_id)
  );
  return v_request_id;
end
$$;

-- Request autocomplete includes out-of-stock items so staff can still ask
-- for them and receive an outside-purchase note. The fulfilment screen filters
-- this result to quantity > 0 before offering a stock match.
create or replace function public.search_ip_stock_catalog(
  p_query text default null,
  p_limit integer default 25
)
returns table(
  stock_type text,
  stock_id uuid,
  name text,
  detail text,
  unit text,
  selling_price_paise bigint,
  pack_price_paise bigint,
  units_per_pack integer,
  quantity bigint,
  price_tiers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null
     or v_role not in ('admin','reception','doctor','ip','pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := nullif(
    lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g')),
    ''
  );

  return query
  with available as (
    select
      'inventory'::text as stock_type,
      inventory.id as stock_id,
      inventory.name::text as name,
      'Inventory item'::text as detail,
      coalesce(nullif(inventory.unit, ''), 'unit')::text as unit,
      inventory.selling_price_paise::bigint as selling_price_paise,
      null::bigint as pack_price_paise,
      1::integer as units_per_pack,
      case
        when inventory.expiry_date is null
          or inventory.expiry_date >= current_date
        then inventory.quantity
        else 0
      end::bigint as quantity,
      null::jsonb as price_tiers,
      inventory.search_text::text as search_text
    from public.inventory_items inventory
    where inventory.active

    union all

    select
      'medicine'::text,
      medicine.id,
      medicine.brand_name::text,
      concat_ws(
        ' · ', nullif(medicine.generic_name, ''),
        nullif(medicine.strength, ''), nullif(medicine.dosage_form, '')
      )::text,
      coalesce(nullif(medicine.dosage_form, ''), 'unit')::text,
      coalesce(round(
        first_batch.selling_price_paise::numeric
        / greatest(first_batch.units_per_pack, 1)
      ), 0)::bigint,
      first_batch.selling_price_paise::bigint,
      coalesce(first_batch.units_per_pack, 1)::integer,
      coalesce(totals.quantity, 0)::bigint,
      totals.price_tiers,
      medicine.search_text::text
    from public.medicine_directory medicine
    left join lateral (
      select
        coalesce(sum(batch.quantity), 0)::bigint as quantity,
        jsonb_agg(
          jsonb_build_object(
            'quantity', batch.quantity,
            'pack_price_paise', batch.selling_price_paise,
            'units_per_pack', batch.units_per_pack
          ) order by batch.expiry_date, batch.id
        ) filter (where batch.quantity > 0) as price_tiers
      from public.medicine_batches batch
      where batch.medicine_id = medicine.id
        and batch.active
        and batch.quantity > 0
        and batch.expiry_date >= current_date
    ) totals on true
    left join lateral (
      select batch.selling_price_paise, batch.units_per_pack
      from public.medicine_batches batch
      where batch.medicine_id = medicine.id
        and batch.active
        and batch.expiry_date >= current_date
      order by case when batch.quantity > 0 then 0 else 1 end,
        batch.expiry_date, batch.id
      limit 1
    ) first_batch on true
    where medicine.active
  )
  select
    available.stock_type, available.stock_id, available.name,
    available.detail, available.unit, available.selling_price_paise,
    available.pack_price_paise, available.units_per_pack,
    available.quantity, available.price_tiers
  from available
  where v_query is null
     or available.search_text like v_query || '%'
     or available.search_text like '% ' || v_query || '%'
  order by
    case when lower(available.name) = v_query then 0 else 1 end,
    case when available.quantity > 0 then 0 else 1 end,
    available.name,
    available.stock_type
  limit least(greatest(coalesce(p_limit, 25), 1), 500);
end
$$;

drop function public.fulfill_ip_inventory_request(uuid, jsonb, uuid);
create function public.fulfill_ip_inventory_request(
  p_request_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_collected_paise bigint default 0,
  p_payment_mode public.payment_mode default null,
  p_reference text default null
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
  v_ticket_total bigint;
  v_ticket_paid bigint;
  v_payment_id uuid;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_collected_paise, 0) < 0 then
    raise exception 'invalid collected amount' using errcode = '23514';
  end if;
  if coalesce(p_collected_paise, 0) > 0 and p_payment_mode is null then
    raise exception 'payment mode is required' using errcode = '23514';
  end if;

  select * into v_request
  from public.ip_inventory_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request unavailable' using errcode = '42501';
  end if;
  if v_request.status = 'fulfilled' then return p_request_id; end if;

  perform 1 from public.ip_tickets
  where id = v_request.ip_ticket_id
  for update;

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
    if not found then continue; end if;

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
        select 1 from public.medicine_directory medicine
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

  update public.ip_inventory_request_items
  set status = 'unavailable', amount_paise = 0
  where request_id = p_request_id and status = 'pending';

  if coalesce(p_collected_paise, 0) > v_total then
    raise exception 'collection exceeds supplied items total'
      using errcode = '23514';
  end if;

  if v_total > 0 then
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

  if coalesce(p_collected_paise, 0) > 0 then
    select coalesce(sum(charge.amount_paise), 0)::bigint
    into v_ticket_total
    from public.ip_charges charge
    where charge.ip_ticket_id = v_request.ip_ticket_id;
    select coalesce(sum(payment.amount_paise), 0)::bigint
    into v_ticket_paid
    from public.ip_payments payment
    where payment.ip_ticket_id = v_request.ip_ticket_id;
    if p_collected_paise > greatest(0, v_ticket_total - v_ticket_paid) then
      raise exception 'collection exceeds IP ticket balance'
        using errcode = '23514';
    end if;
    insert into public.ip_payments(
      ip_ticket_id, amount_paise, mode, reference, notes, idempotency_key
    )
    values(
      v_request.ip_ticket_id, p_collected_paise, p_payment_mode,
      nullif(trim(coalesce(p_reference, '')), ''),
      'Collected at pharmacy for IP item request ' || p_request_id,
      p_idempotency_key
    )
    returning id into v_payment_id;
  end if;

  update public.ip_inventory_requests
  set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(),
      payment_id = v_payment_id
  where id = p_request_id;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values(
    auth.uid(), 'IP_INVENTORY_FULFILLED', 'ip_inventory_request',
    p_request_id,
    jsonb_build_object(
      'total_paise', v_total,
      'collected_paise', coalesce(p_collected_paise, 0)
    )
  );
  return p_request_id;
end
$$;

create or replace function public.list_ip_inventory_requests(
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
  if public.current_app_role() not in ('admin','pharmacy') then
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
      request.created_at,
      request.fulfilled_at,
      coalesce(charge.amount_paise, 0)::bigint as total_paise,
      coalesce(payment.amount_paise, 0)::bigint as collected_paise,
      count(item.id) filter (
        where item.requested_quantity > item.fulfilled_quantity
      )::bigint as shortfall_count
    from public.ip_inventory_requests request
    join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
    left join public.patients patient on patient.id = ticket.patient_id
    join public.ip_inventory_request_items item
      on item.request_id = request.id
    left join public.ip_charges charge
      on charge.source_type = 'ip_inventory_request'
      and charge.source_id = request.id
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
      request.notes, request.status, request.created_at, request.fulfilled_at,
      charge.amount_paise, payment.amount_paise
  )
  select
    requests.request_id, requests.ip_ticket_id, requests.ticket_number,
    requests.patient_name, requests.item_count, requests.notes,
    requests.status, requests.created_at, requests.fulfilled_at,
    requests.total_paise, requests.collected_paise,
    requests.shortfall_count, count(*) over () as total_count
  from requests
  order by
    case when requests.status = 'pending' then 0 else 1 end,
    coalesce(requests.fulfilled_at, requests.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end
$$;

create or replace function public.get_ip_inventory_request_receipt(
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
        not in ('admin','reception','doctor','ip','pharmacy') then
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
    coalesce(charge.amount_paise, 0)::bigint,
    coalesce(payment.amount_paise, 0)::bigint,
    payment.mode::text,
    payment.reference,
    profile.full_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', item.requested_name,
          'quantity', item.fulfilled_quantity,
          'unit_price_paise', item.unit_price_paise,
          'amount_paise', item.amount_paise,
          'source', case
            when item.medicine_id is not null then 'Medicine'
            when item.inventory_item_id is not null then 'Inventory'
            else 'Manual'
          end
        ) order by item.created_at, item.id
      )
      from public.ip_inventory_request_items item
      where item.request_id = request.id
        and item.status = 'fulfilled'
        and item.fulfilled_quantity > 0
    ), '[]'::jsonb)
  from public.ip_inventory_requests request
  join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
  left join public.patients patient on patient.id = ticket.patient_id
  left join public.ip_charges charge
    on charge.source_type = 'ip_inventory_request'
    and charge.source_id = request.id
  left join public.ip_payments payment on payment.id = request.payment_id
  left join public.profiles profile on profile.id = request.fulfilled_by
  where request.id = p_request_id and request.status = 'fulfilled';
end
$$;

drop policy if exists ip_inventory_requests_read
  on public.ip_inventory_requests;
create policy ip_inventory_requests_read
  on public.ip_inventory_requests for select to authenticated
  using (
    (select public.current_app_role())
      in ('admin','reception','ip','doctor','pharmacy')
  );

drop policy if exists "ip_read" on public.ip_tickets;
create policy "ip_read" on public.ip_tickets for select to authenticated
  using (
    (select public.current_app_role())
      = any (array['admin','reception','ip']::public.app_role[])
    or (
      (select public.current_app_role()) = 'doctor'::public.app_role
      and doctor_id = (select public.current_doctor_id())
    )
    or (
      (select public.current_app_role()) = 'pharmacy'::public.app_role
      and public.pharmacy_may_view_ip_ticket(id)
    )
  );

revoke all on function public.create_ip_inventory_request(
  uuid, jsonb, text, uuid
) from public, anon;
grant execute on function public.create_ip_inventory_request(
  uuid, jsonb, text, uuid
) to authenticated, service_role;
revoke all on function public.search_ip_stock_catalog(
  text, integer
) from public, anon;
grant execute on function public.search_ip_stock_catalog(
  text, integer
) to authenticated, service_role;
revoke all on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text
) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text
) to authenticated, service_role;
revoke all on function public.list_ip_inventory_requests(
  text, text, integer, integer
) from public, anon;
grant execute on function public.list_ip_inventory_requests(
  text, text, integer, integer
) to authenticated, service_role;
revoke all on function public.get_ip_inventory_request_receipt(
  uuid
) from public, anon;
grant execute on function public.get_ip_inventory_request_receipt(
  uuid
) to authenticated, service_role;

commit;
