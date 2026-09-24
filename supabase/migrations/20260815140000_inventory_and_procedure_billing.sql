-- Pharmacy inventory: non-medicine consumables (sutures, gauze, bandage rolls,
-- dressing material) and the procedure bills that consume them.
--
-- Kept separate from medicine_directory/medicine_batches on purpose:
--   * doctors must never see gauze in the prescription autocomplete
--   * consumables have no generic name, strength, dosage form, or FEFO batching
--   * pharmacy_sales.prescription_id is NOT NULL, and a walk-in dressing patient
--     has no prescription at all
--
-- A patient can walk in for a dressing without any OP consultation, so both
-- visit_id and doctor_id are nullable on a procedure sale.
begin;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_code integer generated always as identity,
  name text not null,
  unit text,
  selling_price_paise bigint not null check (selling_price_paise >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  expiry_date date,
  active boolean not null default true,
  search_text text generated always as (lower(trim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_items_name_key on public.inventory_items(search_text);
create index if not exists inventory_items_active_idx on public.inventory_items(name) where active;

create table if not exists public.procedure_sales (
  id uuid primary key default gen_random_uuid(),
  sale_number integer generated always as identity,
  patient_id uuid not null references public.patients(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete restrict,
  ip_ticket_id uuid references public.ip_tickets(id) on delete restrict,
  doctor_id uuid references public.doctors(id) on delete restrict,
  procedure_name text not null,
  procedure_fee_paise bigint not null default 0 check (procedure_fee_paise >= 0),
  items_total_paise bigint not null default 0 check (items_total_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  payment_mode public.payment_mode,
  notes text,
  idempotency_key uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists procedure_sales_created_idx on public.procedure_sales(created_at desc);
create index if not exists procedure_sales_patient_idx on public.procedure_sales(patient_id, created_at desc);

create table if not exists public.procedure_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.procedure_sales(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  created_at timestamptz not null default now()
);
create index if not exists procedure_sale_items_sale_idx on public.procedure_sale_items(sale_id);

alter table public.inventory_items enable row level security;
alter table public.procedure_sales enable row level security;
alter table public.procedure_sale_items enable row level security;

-- Consumable stock and procedure billing belong to the pharmacy counter.
create policy inventory_read on public.inventory_items for select to authenticated
  using(public.current_app_role() in ('admin','pharmacy'));
create policy inventory_manage on public.inventory_items for all to authenticated
  using(public.current_app_role() in ('admin','pharmacy'))
  with check(public.current_app_role() in ('admin','pharmacy'));
create policy procedure_sales_role on public.procedure_sales for select to authenticated
  using(public.current_app_role() in ('admin','pharmacy'));
create policy procedure_sale_items_role on public.procedure_sale_items for select to authenticated
  using(public.current_app_role() in ('admin','pharmacy'));

-- Direct writes are blocked: every sale must go through the atomic RPC below so
-- stock can never go negative and a retry can never bill twice.
revoke insert, update, delete on public.procedure_sales from authenticated;
revoke insert, update, delete on public.procedure_sale_items from authenticated;

-- Atomic procedure sale: reserves stock, bills, and stays idempotent ----------
create or replace function public.create_procedure_sale(
  p_patient_id uuid,
  p_visit_id uuid,
  p_doctor_id uuid,
  p_procedure_name text,
  p_procedure_fee_paise bigint,
  p_lines jsonb,
  p_payment_mode public.payment_mode,
  p_notes text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_sale_id uuid; v_line jsonb; v_item public.inventory_items%rowtype;
  v_qty integer; v_items_total bigint := 0;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if coalesce(trim(p_procedure_name),'') = '' then
    raise exception 'procedure name required' using errcode='23514';
  end if;
  if p_procedure_fee_paise < 0 then
    raise exception 'invalid procedure fee' using errcode='23514';
  end if;
  -- Retry of the same submission returns the original sale untouched.
  select id into v_sale_id from public.procedure_sales where idempotency_key = p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;

  insert into public.procedure_sales(patient_id,visit_id,doctor_id,procedure_name,procedure_fee_paise,payment_mode,notes,idempotency_key)
    values(p_patient_id,nullif(p_visit_id,'00000000-0000-0000-0000-000000000000'::uuid),p_doctor_id,trim(p_procedure_name),p_procedure_fee_paise,p_payment_mode,nullif(trim(coalesce(p_notes,'')),''),p_idempotency_key)
    returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity' using errcode='23514'; end if;
    -- Row lock: two counters billing the last roll of gauze cannot both win.
    select * into v_item from public.inventory_items
      where id = (v_line->>'inventory_item_id')::uuid and active for update;
    if not found then raise exception 'inventory item unavailable' using errcode='23514'; end if;
    if v_item.quantity < v_qty then
      raise exception 'insufficient inventory stock' using errcode='23514';
    end if;
    update public.inventory_items
      set quantity = quantity - v_qty, updated_at = now()
      where id = v_item.id;
    insert into public.procedure_sale_items(sale_id,inventory_item_id,quantity,unit_price_paise)
      values(v_sale_id,v_item.id,v_qty,v_item.selling_price_paise);
    v_items_total := v_items_total + (v_qty * v_item.selling_price_paise);
  end loop;

  update public.procedure_sales
    set items_total_paise = v_items_total,
        total_paise = v_items_total + p_procedure_fee_paise
    where id = v_sale_id;

  -- An admitted patient's procedure goes onto the IP ticket instead of being
  -- collected separately at the counter.
  insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key)
  select t.id,'treatment',trim(p_procedure_name),1,v_items_total + p_procedure_fee_paise,'procedure_sale',v_sale_id,p_idempotency_key
  from public.ip_tickets t
  where t.patient_id = p_patient_id and t.status in ('admitted','discharge_pending')
  limit 1;

  -- If it landed on an IP ticket the patient settles it at discharge, so the
  -- counter must NOT also collect for it: clearing payment_mode marks this sale
  -- as billed-to-ticket rather than paid-at-counter.
  update public.procedure_sales s
    set ip_ticket_id = c.ip_ticket_id, payment_mode = null
    from public.ip_charges c
    where c.source_id = v_sale_id and c.source_type = 'procedure_sale' and s.id = v_sale_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'PROCEDURE_SALE_CREATED','procedure_sale',v_sale_id,
           jsonb_build_object('total_paise',v_items_total + p_procedure_fee_paise,'items',jsonb_array_length(coalesce(p_lines,'[]'::jsonb))));
  return v_sale_id;
end $$;

revoke all on function public.create_procedure_sale(uuid,uuid,uuid,text,bigint,jsonb,public.payment_mode,text,uuid) from public;
grant execute on function public.create_procedure_sale(uuid,uuid,uuid,text,bigint,jsonb,public.payment_mode,text,uuid) to authenticated;

-- Inventory search for the billing screen.
create or replace function public.search_inventory_items(p_query text default null, p_limit integer default 25)
returns table(id uuid, item_code integer, name text, unit text, selling_price_paise bigint, quantity integer, low_stock_threshold integer, expiry_date date)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select i.id,i.item_code,i.name,i.unit,i.selling_price_paise,i.quantity,i.low_stock_threshold,i.expiry_date
  from public.inventory_items i
  where i.active
    and (v_query is null or i.search_text like '%'||v_query||'%')
  order by i.name
  limit least(greatest(p_limit,1),100);
end $$;

revoke all on function public.search_inventory_items(text,integer) from public;
grant execute on function public.search_inventory_items(text,integer) to authenticated;

commit;
