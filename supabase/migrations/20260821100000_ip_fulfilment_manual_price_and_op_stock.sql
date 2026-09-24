-- Complete the two read/write paths used from the IP pharmacy workspace:
--
-- * OP users can use the same live medicine availability search as a
--   consultant. It returns availability only, never buying price or supplier
--   data.
-- * An off-catalog IP request is a manual charge, so it must include a real
--   positive unit price. Matched inventory is still priced exclusively from
--   the locked inventory row. The partial conflict predicate is repeated so
--   PostgreSQL can use ip_charges_source_unique_idx when fulfilling a request.
begin;

create or replace function public.search_medicine_availability(p_query text, p_limit integer default 20)
returns table(id uuid, brand_name text, generic_name text, strength text, dosage_form text, quantity bigint, low_stock_threshold bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role; v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'doctor', 'op', 'pharmacy', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := lower(trim(p_query));
  if v_query = '' then return; end if;
  return query
  select m.id, m.brand_name, m.generic_name, m.strength, m.dosage_form,
         coalesce(sum(b.quantity) filter(where b.active and b.expiry_date >= current_date), 0)::bigint,
         coalesce(sum(b.low_stock_threshold) filter(where b.active), 0)::bigint
  from public.medicine_directory m
  left join public.medicine_batches b on b.medicine_id = m.id
  where m.active
    and (m.search_text like v_query || '%' or m.search_text like '% ' || v_query || '%')
  group by m.id
  order by
    case
      when lower(m.brand_name) = v_query then 0
      when m.search_text like v_query || '%' then 1
      when lower(coalesce(m.generic_name, '')) like v_query || '%' then 2
      else 3
    end,
    m.brand_name
  limit least(greatest(p_limit, 1), 25);
end $$;

revoke all on function public.search_medicine_availability(text, integer) from public;
grant execute on function public.search_medicine_availability(text, integer) to authenticated;

create or replace function public.fulfill_ip_inventory_request(
  p_request_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.ip_inventory_requests%rowtype;
  v_line jsonb; v_item public.ip_inventory_request_items%rowtype; v_inventory public.inventory_items%rowtype;
  v_qty integer; v_price bigint; v_inventory_id uuid; v_total bigint := 0;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_request from public.ip_inventory_requests where id = p_request_id for update;
  if not found then raise exception 'request unavailable' using errcode = '42501'; end if;
  if v_request.status = 'fulfilled' then return p_request_id; end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_item from public.ip_inventory_request_items
      where id = (v_line->>'request_item_id')::uuid
        and request_id = p_request_id
        and status = 'pending'
      for update;
    if not found then continue; end if;

    v_qty := coalesce((v_line->>'fulfilled_quantity')::integer, 0);
    if v_qty < 0 then raise exception 'invalid fulfilled quantity' using errcode = '23514'; end if;
    if v_qty = 0 then
      update public.ip_inventory_request_items set status = 'unavailable' where id = v_item.id;
      continue;
    end if;

    v_inventory_id := nullif(v_line->>'inventory_item_id', '')::uuid;
    if v_inventory_id is not null then
      select * into v_inventory from public.inventory_items
        where id = v_inventory_id and active for update;
      if not found or v_inventory.quantity < v_qty then
        raise exception 'insufficient inventory stock for %', coalesce(v_inventory.name, v_item.requested_name)
          using errcode = '23514';
      end if;
      update public.inventory_items
        set quantity = quantity - v_qty, updated_at = now()
        where id = v_inventory.id;
      -- Never accept a browser-provided price for stocked items.
      v_price := v_inventory.selling_price_paise;
    else
      v_price := (v_line->>'unit_price_paise')::bigint;
      if v_price is null or v_price <= 0 then
        raise exception 'manual unit price is required for off-catalog item %', v_item.requested_name
          using errcode = '23514';
      end if;
    end if;

    update public.ip_inventory_request_items
      set fulfilled_quantity = v_qty,
          unit_price_paise = v_price,
          inventory_item_id = v_inventory_id,
          status = 'fulfilled'
      where id = v_item.id;
    v_total := v_total + (v_qty * v_price);
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
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid()
    where id = p_request_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    values(
      auth.uid(), 'IP_INVENTORY_FULFILLED', 'ip_inventory_request', p_request_id,
      jsonb_build_object('total_paise', v_total)
    );
  return p_request_id;
end $$;

revoke all on function public.fulfill_ip_inventory_request(uuid, jsonb, uuid) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(uuid, jsonb, uuid) to authenticated, service_role;

commit;
