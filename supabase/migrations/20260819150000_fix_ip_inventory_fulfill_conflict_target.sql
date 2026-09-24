begin;

-- Bug: fulfill_ip_inventory_request (20260817100000) ends with
--   insert into ip_charges(...) ... on conflict (source_type, source_id) do nothing;
-- but 20260816140000 had already replaced the plain unique constraint on
-- (source_type, source_id) with a *partial* unique index (only rows where
-- both columns are not null -- see that migration's own comment about manual
-- charges). Postgres will not infer a partial index from a bare column list;
-- the ON CONFLICT target must repeat the index's WHERE predicate. Every
-- fulfilment therefore failed outright with
--   42P10 "there is no unique or exclusion constraint matching the ON
--   CONFLICT specification"
-- surfaced to the pharmacist as the generic "The request could not be
-- fulfilled; no stock or charge was changed." -- for every line, catalog-
-- matched or off-catalog alike (off-catalog is just what most testing hit
-- first, since it is the fallback whenever nothing auto-matches by name).
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
  if public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;

  select * into v_request from public.ip_inventory_requests where id = p_request_id for update;
  if not found then raise exception 'request unavailable' using errcode='42501'; end if;
  if v_request.status = 'fulfilled' then return p_request_id; end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    select * into v_item from public.ip_inventory_request_items
      where id = (v_line->>'request_item_id')::uuid and request_id = p_request_id and status = 'pending' for update;
    if not found then continue; end if;

    v_qty := coalesce((v_line->>'fulfilled_quantity')::integer, 0);
    if v_qty < 0 then raise exception 'invalid fulfilled quantity' using errcode='23514'; end if;

    if v_qty = 0 then
      update public.ip_inventory_request_items set status = 'unavailable' where id = v_item.id;
      continue;
    end if;

    v_inventory_id := nullif(v_line->>'inventory_item_id','')::uuid;
    if v_inventory_id is not null then
      -- Row lock: two counters cannot both win the last unit for two different tickets.
      select * into v_inventory from public.inventory_items where id = v_inventory_id and active for update;
      if not found or v_inventory.quantity < v_qty then
        raise exception 'insufficient inventory stock for %', coalesce(v_inventory.name, v_item.requested_name) using errcode='23514';
      end if;
      update public.inventory_items set quantity = quantity - v_qty, updated_at = now() where id = v_inventory.id;
      v_price := v_inventory.selling_price_paise;
    else
      -- Off-catalog: the pharmacist prices it directly, nothing to deduct.
      v_price := coalesce((v_line->>'unit_price_paise')::bigint, 0);
      if v_price < 0 then raise exception 'invalid unit price' using errcode='23514'; end if;
    end if;

    update public.ip_inventory_request_items
      set fulfilled_quantity = v_qty, unit_price_paise = v_price, inventory_item_id = v_inventory_id, status = 'fulfilled'
      where id = v_item.id;
    v_total := v_total + (v_qty * v_price);
  end loop;

  -- Any line left pending (not covered by p_lines) is treated as unavailable
  -- rather than silently staying open forever.
  update public.ip_inventory_request_items set status = 'unavailable'
    where request_id = p_request_id and status = 'pending';

  if v_total > 0 then
    insert into public.ip_charges(ip_ticket_id, category, item, quantity, rate_paise, source_type, source_id, idempotency_key)
      values(
        v_request.ip_ticket_id, 'pharmacy',
        'Pharmacy items · ' || (select count(*) from public.ip_inventory_request_items where request_id = p_request_id and status = 'fulfilled') || ' item(s)',
        1, v_total, 'ip_inventory_request', p_request_id, p_idempotency_key
      )
      on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;

  update public.ip_inventory_requests
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid()
    where id = p_request_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    values(auth.uid(), 'IP_INVENTORY_FULFILLED', 'ip_inventory_request', p_request_id, jsonb_build_object('total_paise', v_total));
  return p_request_id;
end $$;

commit;
