-- Removing a medicine from the library without rewriting hospital history.
--
-- Every FK into medicine_directory is `on delete restrict`, so the moment a
-- medicine has been prescribed, sold, or requested by a ward, a plain DELETE
-- is refused (23503) and the admin is left with no way to take it out of the
-- library. This adds the second half of the lifecycle: a medicine that nothing
-- references is still deleted outright, and one that history depends on is
-- ARCHIVED instead -- it leaves the directory, the autocompletes and the
-- dashboard counters, while every past prescription, sale, bill and stock
-- ledger row keeps pointing at the same unchanged record.
begin;

alter table public.medicine_directory
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- The library list pages through live rows ordered by name. The partial index
-- keeps that ordered scan proportional to the live directory, not to every
-- medicine the hospital has ever archived.
create index if not exists medicine_directory_live_idx
  on public.medicine_directory (brand_name)
  where archived_at is null;

-- Archived rows are the rarer read (one "Removed" view), but the same shape.
create index if not exists medicine_directory_archived_idx
  on public.medicine_directory (archived_at desc)
  where archived_at is not null;

-- The signature grows a flag, so the old three-argument function is dropped
-- rather than left behind as a second overload PostgREST would have to choose
-- between. Existing three-argument callers still resolve to this one.
drop function if exists public.list_medicine_directory(text, integer, integer);

-- `or replace` so re-running this migration against a database that already
-- has the four-argument version is a no-op rather than a 42723.
create or replace function public.list_medicine_directory(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_include_archived boolean default false
)
returns table(
  id uuid,
  brand_name text,
  generic_name text,
  strength text,
  dosage_form text,
  manufacturer text,
  active boolean,
  archived_at timestamptz,
  available_quantity bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The null check matters: current_app_role() is null for a caller with no
  -- profile row, and `null not in (...)` is null, which falls through the
  -- guard rather than tripping it.
  if public.current_app_role() is null or public.current_app_role() not in (
    'admin', 'reception', 'pharmacy', 'doctor', 'op', 'ip'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength,
    medicine.dosage_form,
    medicine.manufacturer,
    medicine.active,
    medicine.archived_at,
    coalesce(sum(batch.quantity) filter (
      where batch.active and batch.expiry_date >= current_date
    ), 0)::bigint,
    count(*) over()
  from public.medicine_directory medicine
  left join public.medicine_batches batch on batch.medicine_id = medicine.id
  -- Two disjoint views of one table: the library, and what was removed from
  -- it. Nothing outside the removed view ever sees an archived medicine.
  where (
      case
        when p_include_archived then medicine.archived_at is not null
        else medicine.archived_at is null
      end
    )
    and (
      nullif(trim(p_query), '') is null
      or medicine.search_text like '%' || lower(trim(p_query)) || '%'
    )
  group by medicine.id
  order by medicine.brand_name
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.list_medicine_directory(text, integer, integer, boolean)
from public, anon;
grant execute on function public.list_medicine_directory(text, integer, integer, boolean)
to authenticated, service_role;

-- Admin-only, one transaction, and it decides for itself which of the two
-- removals is safe. Nothing in the caller can force a destructive delete on a
-- medicine that history depends on.
create or replace function public.delete_medicine(p_medicine_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand text;
  v_archived timestamptz;
  v_held bigint;
  v_mode text;
begin
  -- `is distinct from`, not `<>`: current_app_role() is null for a caller with
  -- no profile row, and `null <> 'admin'` is null, which would fall straight
  -- through this guard instead of tripping it.
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select brand_name, archived_at into v_brand, v_archived
  from public.medicine_directory
  where id = p_medicine_id
  for update;
  if not found then
    raise exception 'medicine not found' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    return jsonb_build_object(
      'mode', 'archived', 'brand_name', v_brand, 'stock_units_held', 0
    );
  end if;

  select coalesce(sum(quantity), 0) into v_held
  from public.medicine_batches
  where medicine_id = p_medicine_id;

  if v_held = 0 then
    -- Counted stock is never silently discarded, so this branch only runs for
    -- a medicine holding nothing. The sub-block is what makes the choice safe:
    -- if ANY row still references the medicine -- including a reference added
    -- by a later migration this function has never heard of -- the delete
    -- raises, the whole attempt is rolled back to here, and it archives.
    begin
      delete from public.medicine_batches where medicine_id = p_medicine_id;
      delete from public.medicine_directory where id = p_medicine_id;
      v_mode := 'deleted';
    exception when foreign_key_violation then
      v_mode := 'archived';
    end;
  else
    v_mode := 'archived';
  end if;

  if v_mode = 'archived' then
    -- Deactivating the batches is what takes the medicine out of the low
    -- stock / out of stock dashboard counters, which read medicine_batches
    -- directly. The rows themselves, and their ledger, stay exactly as they
    -- are.
    update public.medicine_batches
    set active = false
    where medicine_id = p_medicine_id and active;
    update public.medicine_directory
    set active = false, archived_at = now(), archived_by = auth.uid()
    where id = p_medicine_id;
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(),
    case when v_mode = 'deleted' then 'MEDICINE_DELETED' else 'MEDICINE_ARCHIVED' end,
    'medicine', p_medicine_id,
    jsonb_build_object('brand_name', v_brand, 'stock_units_held', v_held)
  );

  return jsonb_build_object(
    'mode', v_mode, 'brand_name', v_brand, 'stock_units_held', v_held
  );
end;
$$;

revoke all on function public.delete_medicine(uuid) from public, anon;
grant execute on function public.delete_medicine(uuid) to authenticated, service_role;

-- The way back, so a removal is never a dead end. Batches are deliberately
-- left inactive: which of them were already inactive before the removal is not
-- recorded anywhere, and guessing would silently put written-off or expired
-- stock back on the shelf. Pharmacy re-activates the ones it still holds.
create or replace function public.restore_medicine(p_medicine_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand text;
begin
  -- `is distinct from`, not `<>`: current_app_role() is null for a caller with
  -- no profile row, and `null <> 'admin'` is null, which would fall straight
  -- through this guard instead of tripping it.
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.medicine_directory
  set active = true, archived_at = null, archived_by = null
  where id = p_medicine_id and archived_at is not null
  returning brand_name into v_brand;
  if not found then
    raise exception 'medicine not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), 'MEDICINE_RESTORED', 'medicine', p_medicine_id,
    jsonb_build_object('brand_name', v_brand)
  );
  return jsonb_build_object('mode', 'restored', 'brand_name', v_brand);
end;
$$;

revoke all on function public.restore_medicine(uuid) from public, anon;
grant execute on function public.restore_medicine(uuid) to authenticated, service_role;

-- Bulk import matches an existing medicine by normalised name, and an archived
-- row still matches. Without this the import would attach its batches and
-- stock-in movements to a medicine that no screen in the application shows.
-- Re-importing a removed medicine is how a hospital says it stocks it again,
-- so the match un-archives it. Unchanged otherwise.
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
  v_restored_medicines integer := 0;
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
    else
      update public.medicine_directory
      set archived_at = null, archived_by = null, active = true
      where id = v_medicine and archived_at is not null;
      if found then
        v_restored_medicines := v_restored_medicines + 1;
      end if;
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
      'restored_medicines', v_restored_medicines,
      'new_batches', v_new_batches, 'updated_batches', v_updated_batches
    )
  );
  return jsonb_build_object(
    'job_id', v_job, 'row_count', v_row_count, 'success_count', v_row_count,
    'created_medicines', v_created_medicines,
    'restored_medicines', v_restored_medicines,
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

commit;
