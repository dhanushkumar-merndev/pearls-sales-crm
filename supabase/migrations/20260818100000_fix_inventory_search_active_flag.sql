begin;

-- search_inventory_items() never returned `active` in its result columns, so
-- the client-side InventoryItem type's `active` field always came back
-- undefined. The Procedure Bill dialog filters candidates with
-- `i.active && i.quantity > 0`, so every item was silently excluded and the
-- "Select item" dropdown always rendered empty, however much stock existed.
drop function if exists public.search_inventory_items(text, integer);
create function public.search_inventory_items(p_query text default null, p_limit integer default 25)
returns table(id uuid, item_code integer, name text, unit text, selling_price_paise bigint, quantity integer, low_stock_threshold integer, expiry_date date, active boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select i.id,i.item_code,i.name,i.unit,i.selling_price_paise,i.quantity,i.low_stock_threshold,i.expiry_date,i.active
  from public.inventory_items i
  where i.active
    and (v_query is null or i.search_text like '%'||v_query||'%')
  order by i.name
  limit least(greatest(p_limit,1),100);
end $$;

revoke all on function public.search_inventory_items(text,integer) from public;
grant execute on function public.search_inventory_items(text,integer) to authenticated;

commit;
