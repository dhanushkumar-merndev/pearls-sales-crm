begin;

-- Medicine batches already have stock_movements. Add optional source and
-- snapshot fields for new movements, then add an equivalent immutable ledger
-- for non-medicine inventory such as gauze and sutures.
alter table public.stock_movements
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists quantity_before integer,
  add column if not exists quantity_after integer;

create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason text not null,
  source_type text,
  source_id uuid,
  idempotency_key uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (quantity_after = quantity_before + quantity_delta)
);

create index if not exists inventory_stock_movements_item_created_idx
  on public.inventory_stock_movements(inventory_item_id, created_at desc);

alter table public.inventory_stock_movements enable row level security;
drop policy if exists inventory_stock_movements_read on public.inventory_stock_movements;
create policy inventory_stock_movements_read
  on public.inventory_stock_movements for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));

revoke all on public.inventory_stock_movements from public, anon, authenticated;
grant select on public.inventory_stock_movements to authenticated;

-- Browser sessions may read inventory, but every quantity change must go
-- through a locked RPC so its plus/minus movement cannot be skipped.
revoke insert, update, delete on public.inventory_items from authenticated;

create or replace function public.save_inventory_item(
  p_item_id uuid,
  p_name text,
  p_unit text,
  p_selling_price_paise bigint,
  p_quantity integer,
  p_low_stock_threshold integer,
  p_expiry_date date,
  p_active boolean,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_item public.inventory_items%rowtype;
  v_item_id uuid;
  v_before integer := 0;
  v_delta integer;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null
     or p_quantity is null or p_quantity < 0
     or coalesce(p_selling_price_paise, -1) < 0
     or coalesce(p_low_stock_threshold, -1) < 0 then
    raise exception 'invalid inventory item' using errcode = '23514';
  end if;

  select (audit.metadata ->> 'inventory_item_id')::uuid into v_existing
  from public.audit_logs audit
  where audit.action = 'INVENTORY_ITEM_SAVED'
    and audit.metadata ->> 'idempotency_key' = p_idempotency_key::text
  order by audit.created_at desc
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_item_id is null then
    insert into public.inventory_items(
      name, unit, selling_price_paise, quantity, low_stock_threshold,
      expiry_date, active
    ) values (
      trim(p_name), nullif(trim(coalesce(p_unit, '')), ''),
      p_selling_price_paise, 0, p_low_stock_threshold, p_expiry_date,
      coalesce(p_active, true)
    ) returning id into v_item_id;
  else
    select * into v_item
    from public.inventory_items
    where id = p_item_id
    for update;
    if not found then
      raise exception 'inventory item unavailable' using errcode = '42501';
    end if;
    v_item_id := v_item.id;
    v_before := v_item.quantity;
    update public.inventory_items
    set name = trim(p_name),
        unit = nullif(trim(coalesce(p_unit, '')), ''),
        selling_price_paise = p_selling_price_paise,
        low_stock_threshold = p_low_stock_threshold,
        expiry_date = p_expiry_date,
        active = coalesce(p_active, true),
        updated_at = now()
    where id = v_item_id;
  end if;

  v_delta := p_quantity - v_before;
  if v_delta <> 0 and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'stock change reason is required' using errcode = '23514';
  end if;

  update public.inventory_items
  set quantity = p_quantity, updated_at = now()
  where id = v_item_id;

  if v_delta <> 0 then
    insert into public.inventory_stock_movements(
      inventory_item_id, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key
    ) values (
      v_item_id, v_delta, v_before, p_quantity,
      coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Opening stock'),
      'inventory_adjustment', v_item_id, p_idempotency_key
    );
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'INVENTORY_ITEM_SAVED', 'inventory_item', v_item_id,
    jsonb_build_object(
      'inventory_item_id', v_item_id,
      'quantity_before', v_before,
      'quantity_after', p_quantity,
      'quantity_delta', v_delta,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'idempotency_key', p_idempotency_key::text
    )
  );
  return v_item_id;
end
$$;

revoke all on function public.save_inventory_item(
  uuid, text, text, bigint, integer, integer, date, boolean, text, uuid
) from public, anon;
grant execute on function public.save_inventory_item(
  uuid, text, text, bigint, integer, integer, date, boolean, text, uuid
) to authenticated, service_role;

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
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.ip_charges(
    ip_ticket_id, category, item, quantity, rate_paise,
    source_type, source_id, idempotency_key
  )
  select t.id, 'treatment', trim(p_procedure_name), 1,
    v_items_total + p_procedure_fee_paise,
    'procedure_sale', v_sale_id, p_idempotency_key
  from public.ip_tickets t
  where t.patient_id = p_patient_id
    and t.status in ('admitted', 'discharge_pending')
  limit 1;

  update public.procedure_sales sale
  set ip_ticket_id = charge.ip_ticket_id, payment_mode = null
  from public.ip_charges charge
  where charge.source_id = v_sale_id
    and charge.source_type = 'procedure_sale'
    and sale.id = v_sale_id;

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
$$;

revoke all on function public.create_procedure_sale(
  uuid, uuid, uuid, text, bigint, jsonb, public.payment_mode, text, uuid
) from public, anon;
grant execute on function public.create_procedure_sale(
  uuid, uuid, uuid, text, bigint, jsonb, public.payment_mode, text, uuid
) to authenticated, service_role;

create or replace function public.bulk_import_medicines(
  p_rows jsonb,
  p_file_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_job uuid;
  v_row jsonb;
  v_medicine uuid;
  v_batch uuid;
  v_before integer;
  v_opening integer;
  v_pack integer;
  v_row_index integer := 0;
  v_created_medicines integer := 0;
  v_new_batches integer := 0;
  v_updated_batches integer := 0;
  v_row_count integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 1000 then
    raise exception 'row count must be between 1 and 1000';
  end if;

  select id into v_job
  from public.bulk_import_jobs
  where idempotency_key = p_idempotency_key;
  if v_job is not null then
    return (
      select jsonb_build_object(
        'job_id', id, 'row_count', row_count, 'success_count', success_count,
        'created_medicines', coalesce((
          select (metadata ->> 'created_medicines')::integer
          from public.audit_logs
          where entity_id = id and action = 'BULK_MEDICINE_IMPORT_COMPLETED'
          order by created_at desc limit 1
        ), 0)
      )
      from public.bulk_import_jobs where id = v_job
    );
  end if;

  insert into public.bulk_import_jobs(
    file_name, row_count, status, idempotency_key
  ) values (
    left(p_file_name, 255), v_row_count, 'processing', p_idempotency_key
  ) returning id into v_job;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_row_index := v_row_index + 1;
    v_opening := coalesce((v_row ->> 'opening_quantity')::integer, 0);
    v_pack := greatest(
      coalesce(nullif(v_row ->> 'units_per_pack', '')::integer, 1), 1
    );
    if v_opening < 0 then
      raise exception 'opening quantity cannot be negative' using errcode = '23514';
    end if;

    select id into v_medicine
    from public.medicine_directory
    where lower(regexp_replace(trim(brand_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(v_row ->> 'medicine_name'), '\s+', ' ', 'g'))
      and lower(regexp_replace(trim(coalesce(generic_name, '')), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(coalesce(v_row ->> 'generic_name', '')), '\s+', ' ', 'g'))
      and lower(regexp_replace(trim(coalesce(strength, '')), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(coalesce(v_row ->> 'strength', '')), '\s+', ' ', 'g'))
      and lower(regexp_replace(trim(dosage_form), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(v_row ->> 'dosage_form'), '\s+', ' ', 'g'));
    if v_medicine is null then
      insert into public.medicine_directory(
        brand_name, generic_name, strength, dosage_form, manufacturer, active, source
      ) values (
        v_row ->> 'medicine_name', nullif(v_row ->> 'generic_name', ''),
        nullif(v_row ->> 'strength', ''), v_row ->> 'dosage_form',
        nullif(v_row ->> 'manufacturer', ''),
        coalesce((v_row ->> 'active')::boolean, true), 'bulk import'
      ) returning id into v_medicine;
      v_created_medicines := v_created_medicines + 1;
    end if;

    select id, quantity into v_batch, v_before
    from public.medicine_batches
    where medicine_id = v_medicine
      and lower(regexp_replace(trim(batch_number), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(v_row ->> 'batch_number'), '\s+', ' ', 'g'))
    for update;
    if v_batch is not null then
      update public.medicine_batches
      set quantity = quantity + v_opening,
          expiry_date = (v_row ->> 'expiry_date')::date,
          purchase_price_paise = nullif(v_row ->> 'purchase_price_paise', '')::bigint,
          selling_price_paise = (v_row ->> 'selling_price_paise')::bigint,
          low_stock_threshold = coalesce((v_row ->> 'low_stock_threshold')::integer, 10),
          active = coalesce((v_row ->> 'active')::boolean, true),
          units_per_pack = v_pack,
          updated_at = now()
      where id = v_batch;
      v_updated_batches := v_updated_batches + 1;
    else
      v_before := 0;
      insert into public.medicine_batches(
        medicine_id, batch_number, expiry_date, quantity, purchase_price_paise,
        selling_price_paise, low_stock_threshold, active, units_per_pack
      ) values (
        v_medicine, v_row ->> 'batch_number', (v_row ->> 'expiry_date')::date,
        v_opening, nullif(v_row ->> 'purchase_price_paise', '')::bigint,
        (v_row ->> 'selling_price_paise')::bigint,
        coalesce((v_row ->> 'low_stock_threshold')::integer, 10),
        coalesce((v_row ->> 'active')::boolean, true), v_pack
      ) returning id into v_batch;
      v_new_batches := v_new_batches + 1;
    end if;

    if v_opening > 0 then
      insert into public.stock_movements(
        batch_id, quantity_delta, reason, idempotency_key,
        source_type, source_id, quantity_before, quantity_after
      ) values (
        v_batch, v_opening, 'Bulk import stock-in',
        md5('bulk_import:' || v_job::text || ':row:' || v_row_index)::uuid,
        'bulk_import', v_job, v_before, v_before + v_opening
      );
    end if;
  end loop;

  update public.bulk_import_jobs
  set success_count = v_row_count, error_count = 0, status = 'ready', completed_at = now()
  where id = v_job;
  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'BULK_MEDICINE_IMPORT_COMPLETED', 'bulk_import_job', v_job,
    jsonb_build_object(
      'file_name', p_file_name, 'row_count', v_row_count,
      'created_medicines', v_created_medicines,
      'new_batches', v_new_batches, 'updated_batches', v_updated_batches
    )
  );
  return jsonb_build_object(
    'job_id', v_job, 'row_count', v_row_count, 'success_count', v_row_count,
    'created_medicines', v_created_medicines,
    'new_batches', v_new_batches, 'updated_batches', v_updated_batches
  );
exception when others then
  if v_job is not null then
    update public.bulk_import_jobs
    set status = 'failed', error_count = v_row_count, completed_at = now()
    where id = v_job;
  end if;
  raise;
end
$$;

revoke all on function public.bulk_import_medicines(jsonb, text, uuid)
from public, anon;
grant execute on function public.bulk_import_medicines(jsonb, text, uuid)
to authenticated, service_role;

-- Keep the established IP fulfilment rules intact while wrapping the former
-- function with locked before/after snapshots. This also upgrades databases
-- which had already applied the earlier IP-counter migration.
alter function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) rename to fulfill_ip_inventory_request_without_stock_ledger;

revoke all on function public.fulfill_ip_inventory_request_without_stock_ledger(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) from public, anon, authenticated, service_role;

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
  v_batch_snapshot jsonb := '[]'::jsonb;
  v_inventory_snapshot jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_stock_id uuid;
  v_before integer;
  v_after integer;
  v_result uuid;
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Match the legacy function's request lock order before taking stock locks.
  perform 1
  from public.ip_inventory_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request unavailable' using errcode = '42501';
  end if;

  -- Lock every possible source first. The original transactional fulfilment
  -- will then consume its normal FEFO selection while no concurrent dispense
  -- can alter the quantities between the two snapshots.
  with locked_batches as (
    select batch.id, batch.quantity
    from public.medicine_batches batch
    where batch.medicine_id in (
      select distinct nullif(line.value ->> 'medicine_id', '')::uuid
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line(value)
      where nullif(line.value ->> 'medicine_id', '') is not null
    )
      and batch.active
      and batch.quantity > 0
      and batch.expiry_date >= current_date
    for update
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity)),
    '[]'::jsonb
  ) into v_batch_snapshot
  from locked_batches;

  with locked_inventory as (
    select item.id, item.quantity
    from public.inventory_items item
    where item.id in (
      select distinct nullif(line.value ->> 'inventory_item_id', '')::uuid
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line(value)
      where nullif(line.value ->> 'inventory_item_id', '') is not null
    )
      and item.active
      and (item.expiry_date is null or item.expiry_date >= current_date)
    for update
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity)),
    '[]'::jsonb
  ) into v_inventory_snapshot
  from locked_inventory;

  v_result := public.fulfill_ip_inventory_request_without_stock_ledger(
    p_request_id, p_lines, p_idempotency_key, p_collected_paise,
    p_payment_mode, p_reference, p_settlement
  );

  for v_snapshot in select value from jsonb_array_elements(v_batch_snapshot) loop
    v_stock_id := (v_snapshot ->> 'id')::uuid;
    v_before := (v_snapshot ->> 'quantity')::integer;
    select quantity into v_after
    from public.medicine_batches
    where id = v_stock_id;
    if v_after is distinct from v_before then
      insert into public.stock_movements(
        batch_id, quantity_delta, reason, idempotency_key,
        source_type, source_id, quantity_before, quantity_after
      ) values (
        v_stock_id, v_after - v_before, 'IP pharmacy request supply',
        md5('ip_inventory_request:' || p_request_id::text || ':batch:' || v_stock_id::text)::uuid,
        'ip_inventory_request', p_request_id, v_before, v_after
      );
    end if;
  end loop;

  for v_snapshot in select value from jsonb_array_elements(v_inventory_snapshot) loop
    v_stock_id := (v_snapshot ->> 'id')::uuid;
    v_before := (v_snapshot ->> 'quantity')::integer;
    select quantity into v_after
    from public.inventory_items
    where id = v_stock_id;
    if v_after is distinct from v_before then
      insert into public.inventory_stock_movements(
        inventory_item_id, quantity_delta, quantity_before, quantity_after,
        reason, source_type, source_id, idempotency_key
      ) values (
        v_stock_id, v_after - v_before, v_before, v_after,
        'IP pharmacy request supply', 'ip_inventory_request', p_request_id,
        md5('ip_inventory_request:' || p_request_id::text || ':inventory:' || v_stock_id::text)::uuid
      );
    end if;
  end loop;

  return v_result;
end
$$;

revoke all on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) from public, anon;
grant execute on function public.fulfill_ip_inventory_request(
  uuid, jsonb, uuid, bigint, public.payment_mode, text, text
) to authenticated, service_role;

commit;
