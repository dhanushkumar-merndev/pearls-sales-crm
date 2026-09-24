begin;

-- Pharmacy fulfils IP consumable requests without creating a counter-payment
-- row: their value belongs to the IP ticket until that ticket is paid. Expose
-- those immutable fulfilments alongside prescription sales so Pharmacy's
-- Sales screen agrees with its dashboard, while retaining a distinct source
-- that the UI can label "Billed to IP" rather than "collected".
create or replace function public.list_pharmacy_sales(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  created_at timestamptz,
  source text,
  total_paise bigint,
  patient_name text,
  patient_phone text,
  dispensed_by text,
  item_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_query text;
  v_digits text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := nullif(trim(coalesce(p_query, '')), '');
  v_digits := regexp_replace(coalesce(v_query, ''), '\D', '', 'g');

  return query
  with activity as (
    select
      sale.id,
      sale.created_at,
      sale.source::text as source,
      sale.total_paise,
      patient.name::text as patient_name,
      patient.phone_normalized::text as patient_phone,
      profile.full_name::text as dispensed_by,
      (
        select count(*)
        from public.pharmacy_sale_items sale_item
        where sale_item.sale_id = sale.id
      )::bigint as item_count
    from public.pharmacy_sales sale
    left join public.patients patient on patient.id = sale.patient_id
    left join public.profiles profile on profile.id = sale.dispensed_by

    union all

    select
      request.id,
      request.fulfilled_at as created_at,
      'ip_items'::text as source,
      lines.total_paise,
      patient.name::text as patient_name,
      patient.phone_normalized::text as patient_phone,
      profile.full_name::text as dispensed_by,
      lines.item_count
    from public.ip_inventory_requests request
    join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
    left join public.patients patient on patient.id = ticket.patient_id
    left join public.profiles profile on profile.id = request.fulfilled_by
    cross join lateral (
      select
        coalesce(sum(
          item.fulfilled_quantity * coalesce(item.unit_price_paise, 0)
        ), 0)::bigint as total_paise,
        count(*) filter (
          where item.status = 'fulfilled' and item.fulfilled_quantity > 0
        )::bigint as item_count
      from public.ip_inventory_request_items item
      where item.request_id = request.id
        and item.status = 'fulfilled'
    ) lines
    where request.fulfilled_at is not null
      and lines.item_count > 0
  ), matched as (
    select activity.*
    from activity
    where v_query is null
       or activity.patient_name ilike '%' || v_query || '%'
       or (
         v_digits <> ''
         and activity.patient_phone like right(v_digits, 10) || '%'
       )
  )
  select
    matched.id,
    matched.created_at,
    matched.source,
    matched.total_paise,
    matched.patient_name,
    matched.patient_phone,
    matched.dispensed_by,
    matched.item_count,
    count(*) over () as total_count
  from matched
  order by matched.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end
$$;

revoke all on function public.list_pharmacy_sales(
  text, integer, integer
) from public, anon;
grant execute on function public.list_pharmacy_sales(
  text, integer, integer
) to authenticated, service_role;

commit;
