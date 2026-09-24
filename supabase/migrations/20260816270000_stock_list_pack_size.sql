-- The stock screen needs the pack size to show "400 tablets (13 x 30 + 10)"
-- and to price a single piece against the pack price.
--
-- The two-argument overload predates the search box and the application never
-- calls it; it is dropped so PostgREST cannot resolve to a version that leaves
-- the pack size out.
begin;

drop function if exists public.list_pharmacy_batches(integer,integer);
drop function if exists public.list_pharmacy_batches(text,integer,integer);

CREATE OR REPLACE FUNCTION public.list_pharmacy_batches(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, medicine_id uuid, batch_number text, expiry_date date, quantity integer, units_per_pack integer, purchase_price_paise bigint, selling_price_paise bigint, low_stock_threshold integer, active boolean, brand_name text, generic_name text, strength text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.app_role;
  v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := lower(trim(coalesce(p_query, '')));

  return query
  select
    b.id,
    b.medicine_id,
    b.batch_number,
    b.expiry_date,
    b.quantity,
    b.units_per_pack,
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
  where v_query = ''
     -- Prefix of the brand, or of any later word (generic, strength, form).
     or m.search_text like v_query || '%'
     or m.search_text like '% ' || v_query || '%'
     or lower(coalesce(m.generic_name, '')) like v_query || '%'
     or lower(b.batch_number) like v_query || '%'
  order by b.expiry_date, b.batch_number
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end
$function$
;

revoke all on function public.list_pharmacy_batches(text,integer,integer) from public, anon;
grant execute on function public.list_pharmacy_batches(text,integer,integer) to authenticated, service_role;

commit;
