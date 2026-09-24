-- Pharmacy inventory and procedure bills stopped at the first page too.
--
-- Same shape as the prescription queue: an offset so later rows are reachable
-- at all, and a window count so the footer can say how many there are. The
-- bills list in particular grows for the life of the hospital.
begin;

drop function if exists public.search_inventory_items(text, integer);
create or replace function public.search_inventory_items(
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
 RETURNS TABLE(id uuid, item_code integer, name text, unit text, selling_price_paise bigint, quantity integer, low_stock_threshold integer, expiry_date date, active boolean, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select i.id,i.item_code,i.name,i.unit,i.selling_price_paise,i.quantity,i.low_stock_threshold,i.expiry_date,i.active,
    count(*) over()
  from public.inventory_items i
  where i.active
    and (v_query is null or i.search_text like '%'||v_query||'%')
  order by i.name
  limit least(greatest(p_limit,1),100)
  offset greatest(p_offset, 0);
end $function$;

revoke all on function public.search_inventory_items(text, integer, integer) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer) to authenticated, service_role;

drop function if exists public.list_procedure_sales(text, integer);
create or replace function public.list_procedure_sales(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
 RETURNS TABLE(id uuid, sale_number integer, procedure_name text, procedure_fee_paise bigint, items_total_paise bigint, total_paise bigint, payment_mode text, ip_ticket_id uuid, created_at timestamp with time zone, patient_name text, patient_uhid text, doctor_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select
    s.id, s.sale_number, s.procedure_name, s.procedure_fee_paise, s.items_total_paise,
    s.total_paise, s.payment_mode::text, s.ip_ticket_id, s.created_at,
    pt.name, pt.uhid, d.display_name,
    count(*) over()
  from public.procedure_sales s
  left join public.patients pt on pt.id = s.patient_id
  left join public.doctors d on d.id = s.doctor_id
  where v_query is null
     or pt.name ilike '%'||v_query||'%'
     or pt.phone_normalized like '%'||regexp_replace(v_query,'\D','','g')||'%'
     or s.procedure_name ilike '%'||v_query||'%'
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit,50),1),200)
  offset greatest(p_offset, 0);
end $function$;

revoke all on function public.list_procedure_sales(text, integer, integer) from public, anon;
grant execute on function public.list_procedure_sales(text, integer, integer) to authenticated, service_role;

commit;
