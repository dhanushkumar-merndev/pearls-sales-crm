begin;

-- Pharmacy/admin require cost-aware batch search, while browser roles must
-- continue to be unable to select protected price columns from the base table.
create function public.list_pharmacy_batches(
  p_query text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  medicine_id uuid,
  batch_number text,
  expiry_date date,
  quantity integer,
  purchase_price_paise bigint,
  selling_price_paise bigint,
  low_stock_threshold integer,
  active boolean,
  brand_name text,
  generic_name text,
  strength text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.medicine_id,
    b.batch_number,
    b.expiry_date,
    b.quantity,
    b.purchase_price_paise,
    b.selling_price_paise,
    b.low_stock_threshold,
    b.active,
    m.brand_name,
    m.generic_name,
    m.strength,
    count(*) over()
  from public.medicine_batches b
  join public.medicine_directory m on m.id = b.medicine_id
  where trim(coalesce(p_query, '')) = ''
     or m.search_text like lower(trim(p_query)) || '%'
     or lower(b.batch_number) like lower(trim(p_query)) || '%'
  order by b.expiry_date, b.batch_number
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end
$$;

revoke all on function public.list_pharmacy_batches(text, integer, integer) from public;
grant execute on function public.list_pharmacy_batches(text, integer, integer) to authenticated;

commit;
