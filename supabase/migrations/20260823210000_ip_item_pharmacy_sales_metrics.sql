begin;

-- IP item fulfilment is a pharmacy dispense and has its own immutable ledger
-- (request + fulfilled lines). Include that value on the pharmacy dashboard
-- without copying it into pharmacy_sales or counting it as cash collected.
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

  -- These keys are deliberately absent for roles that cannot see pharmacy
  -- money. Preserve that role filtering rather than adding the keys back.
  if v_summary ? 'pharmacy_sales_today_paise'
     or v_summary ? 'dispensed_today'
  then
    select
      coalesce(sum(
        case when item.status = 'fulfilled'
          then item.fulfilled_quantity * coalesce(item.unit_price_paise, 0)
          else 0
        end
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
grant execute on function public.dashboard_summary() to authenticated, service_role;

-- Keep the guarded drill-down aligned with the KPI. Prescription sales and
-- IP item fulfilments are merged chronologically; only counter receipts are
-- linked because an IP fulfilment remains payable on the final IP bill.
create or replace function public.dashboard_metric_detail_for_role(
  p_metric text,
  p_limit integer default 25
)
returns table(
  primary_text text,
  secondary_text text,
  trailing_text text,
  href text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_doctor uuid;
  v_limit integer;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);

  if v_role is null or not (
    v_role = 'admin'
    or (v_role = 'reception' and p_metric = any(array[
      'patients_today','visits_today','waiting','followups_due',
      'reports_ready','collected_today_paise'
    ]))
    or (v_role = 'op' and p_metric = any(array[
      'patients_seen_today','waiting','vitals_pending','ready','completed',
      'reports_pending'
    ]))
    or (v_role = 'doctor' and p_metric = any(array[
      'waiting','ready','completed','followups_due','reports_ready','current_ip'
    ]))
    or (v_role = 'ip' and p_metric = any(array[
      'current_ip','admissions_today','discharges_today','discharge_pending',
      'ip_collection_paise','ip_balance_paise'
    ]))
    or (v_role = 'pharmacy' and p_metric = any(array[
      'pending_prescriptions','pharmacy_sales_today_paise','low_stock',
      'out_of_stock','expiring_soon','dispensed_today'
    ]))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_metric in ('pharmacy_sales_today_paise', 'dispensed_today') then
    return query
    with activity as (
      select
        sale.created_at as sort_at,
        coalesce(patient.name, 'Unknown patient')::text as primary_text,
        (
          to_char(
            sale.created_at at time zone 'Asia/Kolkata',
            'HH12:MI AM'
          ) || ' · ' || upper(sale.source::text) || ' RX'
        )::text as secondary_text,
        to_char(
          sale.total_paise / 100.0,
          'FM999999990.00'
        )::text as trailing_text,
        ('/print/receipt/' || sale.id)::text as href
      from public.pharmacy_sales sale
      left join public.patients patient on patient.id = sale.patient_id
      where (sale.created_at at time zone 'Asia/Kolkata')::date =
            (now() at time zone 'Asia/Kolkata')::date

      union all

      select
        request.fulfilled_at as sort_at,
        coalesce(patient.name, 'Unidentified emergency')::text as primary_text,
        (
          to_char(
            request.fulfilled_at at time zone 'Asia/Kolkata',
            'HH12:MI AM'
          ) || ' · IP ITEMS'
        )::text as secondary_text,
        to_char(
          coalesce(lines.total_paise, 0) / 100.0,
          'FM999999990.00'
        )::text as trailing_text,
        null::text as href
      from public.ip_inventory_requests request
      join public.ip_tickets ticket on ticket.id = request.ip_ticket_id
      left join public.patients patient on patient.id = ticket.patient_id
      cross join lateral (
        select
          coalesce(sum(
            item.fulfilled_quantity * coalesce(item.unit_price_paise, 0)
          ), 0)::bigint as total_paise,
          count(*) filter (
            where item.status = 'fulfilled' and item.fulfilled_quantity > 0
          ) as fulfilled_lines
        from public.ip_inventory_request_items item
        where item.request_id = request.id
          and item.status = 'fulfilled'
      ) lines
      where request.fulfilled_at is not null
        and lines.fulfilled_lines > 0
        and (request.fulfilled_at at time zone 'Asia/Kolkata')::date =
            (now() at time zone 'Asia/Kolkata')::date
    )
    select
      activity.primary_text,
      activity.secondary_text,
      activity.trailing_text,
      activity.href
    from activity
    order by activity.sort_at desc
    limit v_limit;
    return;
  end if;

  if v_role = 'doctor' and p_metric = 'reports_ready' then
    return query
    select
      patient.name,
      report.report_name,
      replace(report.status::text, '_', ' '),
      '/doctor/follow-ups'
    from public.patient_reports report
    join public.patients patient on patient.id = report.patient_id
    left join public.visits visit on visit.id = report.visit_id
    left join public.test_orders test_order on test_order.id = report.test_order_id
    left join public.ip_tickets ticket on ticket.id = report.ip_ticket_id
    where report.status = 'ready'
      and (
        visit.doctor_id = v_doctor
        or test_order.doctor_id = v_doctor
        or ticket.doctor_id = v_doctor
      )
    order by report.created_at desc
    limit v_limit;
    return;
  end if;

  return query
  select
    detail.primary_text,
    detail.secondary_text,
    detail.trailing_text,
    detail.href
  from public.dashboard_metric_detail(p_metric, v_limit) detail;
end;
$$;

revoke all on function public.dashboard_metric_detail_for_role(
  text, integer
) from public, anon;
grant execute on function public.dashboard_metric_detail_for_role(
  text, integer
) to authenticated, service_role;

commit;
