-- Load every live batch for only the medicines in the prescription. The old
-- page query silently stopped after the first 500 batches hospital-wide, so a
-- valid later batch could appear missing. This RPC has a bounded input and an
-- explicit error instead of silently returning a partial stock picture.
begin;

create or replace function public.list_dispense_batches_for_medicines(
  p_medicine_ids uuid[]
)
returns table(
  id uuid,
  medicine_id uuid,
  batch_number text,
  expiry_date date,
  quantity integer,
  selling_price_paise bigint,
  units_per_pack integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_medicine_ids is null
     or cardinality(p_medicine_ids) < 1
     or cardinality(p_medicine_ids) > 50
     or array_position(p_medicine_ids, null) is not null then
    raise exception 'invalid medicine list' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
  from public.medicine_batches batch
  where batch.medicine_id = any(p_medicine_ids)
    and batch.active
    and batch.quantity > 0
    and batch.expiry_date >= current_date;
  if v_count > 2000 then
    raise exception 'too many available batches' using errcode = '54000';
  end if;

  return query
  select
    batch.id,
    batch.medicine_id,
    batch.batch_number,
    batch.expiry_date,
    batch.quantity,
    batch.selling_price_paise,
    batch.units_per_pack
  from public.medicine_batches batch
  where batch.medicine_id = any(p_medicine_ids)
    and batch.active
    and batch.quantity > 0
    and batch.expiry_date >= current_date
  order by batch.medicine_id, batch.expiry_date, batch.batch_number, batch.id;
end;
$$;

revoke all on function public.list_dispense_batches_for_medicines(uuid[])
from public, anon;
grant execute on function public.list_dispense_batches_for_medicines(uuid[])
to authenticated, service_role;

commit;
