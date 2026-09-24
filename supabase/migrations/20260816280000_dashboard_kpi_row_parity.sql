-- OP and IP dashboards had 5 and 4 KPI cards respectively, which left an
-- uneven gap in the last row of the grid (grid-cols-2/3/6). Both dashboards
-- now show 6 cards, matching admin (12), reception (6), doctor (6) and
-- pharmacy (6) so every role's KPI grid fills complete rows.
--
-- New cards use metrics dashboard_summary() already returns for these roles:
--   op -> patients_seen_today ("Patients Today")
--   ip -> ip_collection_paise ("IP Collected Today"), discharge_pending was
--         already allowed but is included here for clarity.
-- dashboard_metric_detail() already has branches for both metrics, so only
-- the role/metric allow-list needs widening.
begin;

create or replace function public.dashboard_metric_detail_for_role(
  p_metric text,
  p_limit integer default 25
)
returns table(primary_text text, secondary_text text, trailing_text text, href text)
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
      'patients_seen_today','waiting','vitals_pending','ready','completed','reports_pending'
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
  select detail.primary_text, detail.secondary_text, detail.trailing_text, detail.href
  from public.dashboard_metric_detail(p_metric, v_limit) detail;
end
$$;

revoke all on function public.dashboard_metric_detail_for_role(text, integer) from public, anon;
grant execute on function public.dashboard_metric_detail_for_role(text, integer) to authenticated, service_role;

commit;
