begin;

-- An IP item request can be fulfilled from either non-medicine inventory or
-- the medicine directory/batches. Keep both foreign keys explicit so the
-- historical source remains traceable and exactly one stock system changes.
alter table public.ip_inventory_request_items
  add column if not exists medicine_id uuid
    references public.medicine_directory(id) on delete restrict;

alter table public.ip_inventory_request_items
  add constraint ip_inventory_request_items_one_stock_source
  check (num_nonnulls(inventory_item_id, medicine_id) <= 1);

-- One safe, role-guarded catalogue for IP request autocomplete and pharmacy
-- fulfilment. Medicines are grouped across valid batches and priced from the
-- first-expiring available batch; the fulfilment RPC repeats all validation
-- under row locks and never trusts these displayed values.
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
  if v_role is null or v_role not in ('admin','doctor','ip','pharmacy') then
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
      inventory.quantity::bigint as quantity,
      null::jsonb as price_tiers,
      inventory.search_text::text as search_text
    from public.inventory_items inventory
    where inventory.active
      and inventory.quantity > 0
      and (inventory.expiry_date is null or inventory.expiry_date >= current_date)

    union all

    select
      'medicine'::text as stock_type,
      medicine.id as stock_id,
      medicine.brand_name::text as name,
      concat_ws(
        ' · ',
        nullif(medicine.generic_name, ''),
        nullif(medicine.strength, ''),
        nullif(medicine.dosage_form, '')
      )::text as detail,
      coalesce(nullif(medicine.dosage_form, ''), 'unit')::text as unit,
      round(
        first_batch.selling_price_paise::numeric
        / greatest(first_batch.units_per_pack, 1)
      )::bigint as selling_price_paise,
      first_batch.selling_price_paise::bigint as pack_price_paise,
      first_batch.units_per_pack::integer as units_per_pack,
      totals.quantity::bigint as quantity,
      totals.price_tiers,
      medicine.search_text::text as search_text
    from public.medicine_directory medicine
    join lateral (
      select
        sum(batch.quantity)::bigint as quantity,
        jsonb_agg(
          jsonb_build_object(
            'quantity', batch.quantity,
            'pack_price_paise', batch.selling_price_paise,
            'units_per_pack', batch.units_per_pack
          )
          order by batch.expiry_date, batch.id
        ) as price_tiers
      from public.medicine_batches batch
      where batch.medicine_id = medicine.id
        and batch.active
        and batch.quantity > 0
        and batch.expiry_date >= current_date
    ) totals on totals.quantity > 0
    join lateral (
      select
        batch.selling_price_paise,
        batch.units_per_pack
      from public.medicine_batches batch
      where batch.medicine_id = medicine.id
        and batch.active
        and batch.quantity > 0
        and batch.expiry_date >= current_date
      order by batch.expiry_date, batch.id
      limit 1
    ) first_batch on true
    where medicine.active
  )
  select
    available.stock_type,
    available.stock_id,
    available.name,
    available.detail,
    available.unit,
    available.selling_price_paise,
    available.pack_price_paise,
    available.units_per_pack,
    available.quantity,
    available.price_tiers
  from available
  where v_query is null
     or available.search_text like v_query || '%'
     or available.search_text like '% ' || v_query || '%'
  order by
    case when lower(available.name) = v_query then 0 else 1 end,
    available.name,
    available.stock_type
  limit least(greatest(coalesce(p_limit, 25), 1), 500);
end
$$;

revoke all on function public.search_ip_stock_catalog(
  text, integer
) from public, anon;
grant execute on function public.search_ip_stock_catalog(
  text, integer
) to authenticated, service_role;

create or replace function public.fulfill_ip_inventory_request(
  p_request_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
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
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select *
  into v_request
  from public.ip_inventory_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request unavailable' using errcode = '42501';
  end if;
  if v_request.status = 'fulfilled' then
    return p_request_id;
  end if;

  for v_line in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    select *
    into v_item
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
      set status = 'unavailable'
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
      select *
      into v_inventory
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
      set quantity = quantity - v_qty,
          updated_at = now()
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
          and batch.active
          and batch.quantity > 0
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
        set quantity = quantity - v_take,
            updated_at = now()
        where id = v_batch.id;
        v_remaining := v_remaining - v_take;
      end loop;

      if v_remaining > 0 then
        raise exception 'insufficient medicine stock for %', v_item.requested_name
          using errcode = '23514';
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
        inventory_item_id = v_inventory_id,
        medicine_id = v_medicine_id,
        status = 'fulfilled'
    where id = v_item.id;

    v_total := v_total + v_line_total;
  end loop;

  update public.ip_inventory_request_items
  set status = 'unavailable'
  where request_id = p_request_id and status = 'pending';

  if v_total > 0 then
    insert into public.ip_charges(
      ip_ticket_id, category, item, quantity, rate_paise,
      source_type, source_id, idempotency_key
    )
    values(
      v_request.ip_ticket_id,
      'pharmacy',
      'Pharmacy items · ' || (
        select count(*)
        from public.ip_inventory_request_items
        where request_id = p_request_id and status = 'fulfilled'
      ) || ' item(s)',
      1,
      v_total,
      'ip_inventory_request',
      p_request_id,
      p_idempotency_key
    )
    on conflict (source_type, source_id)
      where source_type is not null and source_id is not null
      do nothing;
  end if;

  update public.ip_inventory_requests
  set status = 'fulfilled',
      fulfilled_at = now(),
      fulfilled_by = auth.uid()
  where id = p_request_id;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  )
  values(
    auth.uid(),
    'IP_INVENTORY_FULFILLED',
    'ip_inventory_request',
    p_request_id,
    jsonb_build_object('total_paise', v_total)
  );

  return p_request_id;
end
$$;

revoke all on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid
) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid
) to authenticated, service_role;

commit;
