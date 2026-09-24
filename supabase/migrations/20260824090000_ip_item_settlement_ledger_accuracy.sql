begin;

-- Keep the invariant at the table boundary as well as in the fulfilment RPC.
-- NOT VALID avoids rewriting historical data while still protecting every
-- new or updated line.
alter table public.ip_inventory_request_items
  drop constraint if exists ip_inventory_request_items_fulfilled_lte_requested;
alter table public.ip_inventory_request_items
  add constraint ip_inventory_request_items_fulfilled_lte_requested
  check (fulfilled_quantity <= requested_quantity) not valid;

create unique index if not exists ip_inventory_requests_payment_unique_idx
  on public.ip_inventory_requests(payment_id)
  where payment_id is not null;

-- The sales ledger is a dispense ledger, but settlement must be explicit:
-- an IP request may be fully/partly collected at the pharmacy or left on the
-- IP ticket. Use the exact amount stored by the atomic FEFO fulfilment rather
-- than recomputing quantity * rounded average price.
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
      case
        when coalesce(payment.amount_paise, 0) >= lines.total_paise
          and lines.total_paise > 0 then 'ip_items_collected'
        when coalesce(payment.amount_paise, 0) > 0 then 'ip_items_partial'
        else 'ip_items'
      end::text as source,
      lines.total_paise,
      patient.name::text as patient_name,
      patient.phone_normalized::text as patient_phone,
      profile.full_name::text as dispensed_by,
      lines.item_count
    from public.ip_inventory_requests request
    join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
    left join public.patients patient on patient.id = ticket.patient_id
    left join public.profiles profile on profile.id = request.fulfilled_by
    left join public.ip_payments payment on payment.id = request.payment_id
    cross join lateral (
      select
        coalesce(sum(item.amount_paise), 0)::bigint as total_paise,
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

-- Keep Today's Sales and Dispensed Today aligned with the exact immutable
-- request-line amounts. Collections continue to come from ip_payments, so a
-- counter payment is not counted once as a sale and again as new revenue.
create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_ip_item_value bigint;
  v_ip_item_dispenses bigint;
begin
  if public.current_app_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_summary := public.dashboard_summary_internal();

  if v_summary ? 'pharmacy_sales_today_paise'
     or v_summary ? 'dispensed_today'
  then
    select
      coalesce(sum(
        case when item.status = 'fulfilled' then item.amount_paise else 0 end
      ), 0)::bigint,
      count(distinct request.id) filter (
        where item.status = 'fulfilled' and item.fulfilled_quantity > 0
      )::bigint
    into v_ip_item_value, v_ip_item_dispenses
    from public.ip_inventory_requests request
    left join public.ip_inventory_request_items item
      on item.request_id = request.id
    where request.fulfilled_at is not null
      and (request.fulfilled_at at time zone 'Asia/Kolkata')::date =
          (now() at time zone 'Asia/Kolkata')::date;
  end if;

  if v_summary ? 'pharmacy_sales_today_paise' then
    v_summary := jsonb_set(
      v_summary,
      '{pharmacy_sales_today_paise}',
      to_jsonb(
        coalesce((v_summary ->> 'pharmacy_sales_today_paise')::bigint, 0)
        + coalesce(v_ip_item_value, 0)
      )
    );
  end if;

  if v_summary ? 'dispensed_today' then
    v_summary := jsonb_set(
      v_summary,
      '{dispensed_today}',
      to_jsonb(
        coalesce((v_summary ->> 'dispensed_today')::bigint, 0)
        + coalesce(v_ip_item_dispenses, 0)
      )
    );
  end if;

  return v_summary;
end;
$$;

revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary()
  to authenticated, service_role;

commit;
