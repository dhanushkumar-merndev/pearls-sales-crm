-- IP staff or the treating doctor can now ask the pharmacy counter for
-- consumables (dressing, syringes, etc.) for an admitted patient without
-- being the ones who actually touch stock. This mirrors the existing
-- OP pattern (prescribe -> pharmacy pending queue -> pharmacy dispenses,
-- AGENTS.md 28A) instead of the pharmacy-only, immediate
-- create_procedure_sale used at the counter today.
--
-- The requester just types what they need in plain words (they have no
-- access to the inventory_items catalog -- pharmacy owns that). Pharmacy is
-- the one who, at fulfilment time, decides whether a line matches a real
-- catalog item (stock deducts atomically, priced at the catalog price) or is
-- genuinely off-catalog (priced manually, nothing to deduct because there is
-- no stock row for it). A line the pharmacist does not fulfil is left
-- unavailable -- no charge, no stock change, the patient is told to buy it
-- outside. Whatever was actually fulfilled bills to the IP ticket in one
-- charge line, the same way a medicine dispense already auto-charges it.
begin;

create table public.ip_inventory_requests (
  id uuid primary key default gen_random_uuid(),
  ip_ticket_id uuid not null references public.ip_tickets(id) on delete restrict,
  requested_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  notes text,
  status text not null default 'pending' check (status in ('pending','fulfilled')),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid references public.profiles(id) on delete restrict
);
create index ip_inventory_requests_ticket_idx on public.ip_inventory_requests(ip_ticket_id, created_at desc);
create index ip_inventory_requests_pending_idx on public.ip_inventory_requests(created_at) where status = 'pending';

create table public.ip_inventory_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ip_inventory_requests(id) on delete restrict,
  -- What the requester typed, e.g. "IV cannula 20G". Kept even after pharmacy
  -- links the line to a catalog item, so the original ask stays on record.
  requested_name text not null check (length(trim(requested_name)) >= 2),
  -- Filled in by pharmacy at fulfilment if this line is sourced from real
  -- stock. Null the whole time for a genuinely off-catalog line.
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  requested_quantity integer not null check (requested_quantity > 0),
  fulfilled_quantity integer not null default 0 check (fulfilled_quantity >= 0),
  unit_price_paise bigint check (unit_price_paise is null or unit_price_paise >= 0),
  status text not null default 'pending' check (status in ('pending','fulfilled','unavailable')),
  created_at timestamptz not null default now()
);
create index ip_inventory_request_items_request_idx on public.ip_inventory_request_items(request_id);

alter table public.ip_inventory_requests enable row level security;
alter table public.ip_inventory_request_items enable row level security;

-- Read: everyone who touches an IP ticket, plus pharmacy who fulfils these.
create policy ip_inventory_requests_read on public.ip_inventory_requests for select to authenticated
  using(public.current_app_role() in ('admin','ip','doctor','pharmacy'));
create policy ip_inventory_request_items_read on public.ip_inventory_request_items for select to authenticated
  using(exists(select 1 from public.ip_inventory_requests r where r.id = request_id));

-- Every write (create or fulfil) goes through the RPCs below so quantities
-- and the IP charge stay atomic and idempotent, the same discipline as every
-- other stock- or money-affecting table in this schema.
revoke insert, update, delete on public.ip_inventory_requests from authenticated;
revoke insert, update, delete on public.ip_inventory_request_items from authenticated;

-- 1. Create a request -- no inventory access needed, just names + quantities.
create function public.create_ip_inventory_request(
  p_ticket_id uuid,
  p_lines jsonb,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role; v_doctor uuid; v_ticket public.ip_tickets%rowtype;
  v_request_id uuid; v_line jsonb; v_name text; v_qty integer;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role not in ('admin','ip','doctor') then raise exception 'forbidden' using errcode='42501'; end if;

  select id into v_request_id from public.ip_inventory_requests where idempotency_key = p_idempotency_key;
  if v_request_id is not null then return v_request_id; end if;

  select * into v_ticket from public.ip_tickets where id = p_ticket_id and status in ('admitted','discharge_pending') for update;
  if not found then raise exception 'IP ticket unavailable' using errcode='42501'; end if;
  if v_role = 'doctor' and v_ticket.doctor_id is distinct from v_doctor then
    raise exception 'doctor may only request items for their own patient' using errcode='42501';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) < 1 then raise exception 'at least one item is required' using errcode='23514'; end if;

  insert into public.ip_inventory_requests(ip_ticket_id, requested_by, notes, idempotency_key)
    values(p_ticket_id, auth.uid(), nullif(trim(coalesce(p_notes,'')),''), p_idempotency_key)
    returning id into v_request_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_name := trim(coalesce(v_line->>'name',''));
    v_qty := (v_line->>'quantity')::integer;
    if v_name = '' then raise exception 'item name is required' using errcode='23514'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity' using errcode='23514'; end if;
    insert into public.ip_inventory_request_items(request_id, requested_name, requested_quantity)
      values(v_request_id, v_name, v_qty);
  end loop;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    values(auth.uid(), 'IP_INVENTORY_REQUESTED', 'ip_inventory_request', v_request_id, jsonb_build_object('ip_ticket_id', p_ticket_id));
  return v_request_id;
end $$;

revoke all on function public.create_ip_inventory_request(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.create_ip_inventory_request(uuid, jsonb, text, uuid) to authenticated, service_role;

-- 2. Fulfil a request -------------------------------------------------------
-- p_lines: [{ request_item_id, inventory_item_id?, fulfilled_quantity, unit_price_paise? }]
-- inventory_item_id present  -> sourced from real stock, deducted atomically, priced from the catalog.
-- inventory_item_id absent   -> off-catalog, priced from unit_price_paise (pharmacist enters it).
-- fulfilled_quantity 0 (or the line omitted entirely) -> unavailable, no charge, no stock change.
create function public.fulfill_ip_inventory_request(
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
      on conflict (source_type, source_id) do nothing;
  end if;

  update public.ip_inventory_requests
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid()
    where id = p_request_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    values(auth.uid(), 'IP_INVENTORY_FULFILLED', 'ip_inventory_request', p_request_id, jsonb_build_object('total_paise', v_total));
  return p_request_id;
end $$;

revoke all on function public.fulfill_ip_inventory_request(uuid, jsonb, uuid) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(uuid, jsonb, uuid) to authenticated, service_role;

-- 3. Pharmacy's queue: what's pending, across every ticket, searchable.
create function public.list_pending_ip_inventory_requests(p_query text default null, p_limit integer default 50)
returns table(
  request_id uuid, ip_ticket_id uuid, ticket_number text, patient_name text,
  item_count bigint, notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select r.id, r.ip_ticket_id, t.ticket_number, coalesce(p.name, 'Unidentified emergency'),
         count(i.id), r.notes, r.created_at
  from public.ip_inventory_requests r
  join public.ip_tickets t on t.id = r.ip_ticket_id
  left join public.patients p on p.id = t.patient_id
  join public.ip_inventory_request_items i on i.request_id = r.id
  where r.status = 'pending'
    and (v_query is null or t.ticket_number ilike '%'||v_query||'%' or p.name ilike '%'||v_query||'%')
  group by r.id, r.ip_ticket_id, t.ticket_number, p.name, r.notes, r.created_at
  order by r.created_at
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

revoke all on function public.list_pending_ip_inventory_requests(text, integer) from public, anon;
grant execute on function public.list_pending_ip_inventory_requests(text, integer) to authenticated, service_role;

commit;
