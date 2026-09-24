-- Backs the KPI drill-down dialog: tapping a dashboard card explains what the
-- number counts and lists the records behind it (AGENTS.md 7.1).
--
-- One definer function rather than per-metric endpoints, so the role guard and
-- the row limit are enforced in a single place. Every branch reuses the same
-- shape (primary / secondary / trailing / href) so the dialog stays generic.
--
-- Financial metrics are gated separately: a metric is only answerable if the
-- caller's role may see that number on their own dashboard.
begin;

create or replace function public.dashboard_metric_detail(
  p_metric text,
  p_limit integer default 25
)
returns table(primary_text text, secondary_text text, trailing_text text, href text)
language plpgsql stable security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_doctor uuid;
  v_today date;
  v_limit integer;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role is null then raise exception 'forbidden' using errcode='42501'; end if;
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_limit := least(greatest(p_limit, 1), 100);

  -- Money detail is restricted to the roles that see money at all.
  if p_metric like '%_paise' and v_role not in ('admin','reception','ip','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_metric in ('visits_today','patients_seen_today','waiting','ready','completed','vitals_pending') then
    return query
    select p.name,
           'Token #' || v.token_number || ' · ' || d.display_name,
           replace(v.status::text, '_', ' '),
           '/visits/' || v.id
    from public.visits v
    join public.patients p on p.id = v.patient_id
    join public.doctors d on d.id = v.doctor_id
    where v.visit_date = v_today
      and (v_role <> 'doctor' or v.doctor_id = v_doctor)
      and (
        p_metric in ('visits_today','patients_seen_today')
        or (p_metric = 'waiting' and v.status in ('waiting','vitals_pending'))
        or (p_metric = 'vitals_pending' and v.status in ('waiting','vitals_pending'))
        or (p_metric = 'ready' and v.status = 'ready')
        or (p_metric = 'completed' and v.status = 'completed')
      )
    order by v.token_number
    limit v_limit;

  elsif p_metric = 'patients_today' then
    return query
    select p.name, p.uhid || ' · ' || p.phone_normalized, to_char(p.created_at at time zone 'Asia/Kolkata','HH12:MI AM'), '/patients/' || p.id
    from public.patients p
    where (p.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by p.created_at desc
    limit v_limit;

  elsif p_metric in ('current_ip','admissions_today','discharges_today','discharge_pending') then
    return query
    select coalesce(p.name, 'Unidentified emergency'),
           t.ticket_number || ' · ' || d.display_name,
           coalesce(t.room, '—') || '/' || coalesce(t.bed, '—'),
           '/ip/' || t.id
    from public.ip_tickets t
    left join public.patients p on p.id = t.patient_id
    join public.doctors d on d.id = t.doctor_id
    where (v_role <> 'doctor' or t.doctor_id = v_doctor)
      and (
        (p_metric = 'current_ip' and t.status in ('admitted','discharge_pending'))
        or (p_metric = 'discharge_pending' and t.status = 'discharge_pending')
        or (p_metric = 'admissions_today' and (t.admission_at at time zone 'Asia/Kolkata')::date = v_today)
        or (p_metric = 'discharges_today' and t.discharge_at is not null and (t.discharge_at at time zone 'Asia/Kolkata')::date = v_today)
      )
    order by t.admission_at desc
    limit v_limit;

  elsif p_metric = 'pending_prescriptions' then
    return query
    select coalesce(vp.name, ip.name, 'Patient'),
           'RX-' || lpad(rx.prescription_number::text, 6, '0') || ' · ' || d.display_name,
           replace(rx.status::text, '_', ' '),
           '/pharmacy'
    from public.prescriptions rx
    left join public.visits v on v.id = rx.visit_id
    left join public.patients vp on vp.id = v.patient_id
    left join public.ip_tickets t on t.id = rx.ip_ticket_id
    left join public.patients ip on ip.id = t.patient_id
    join public.doctors d on d.id = rx.doctor_id
    where rx.status in ('pending','partially_dispensed')
    order by rx.created_at
    limit v_limit;

  elsif p_metric in ('low_stock','out_of_stock','expiring_soon') then
    return query
    select m.brand_name,
           'Batch ' || b.batch_number || ' · expires ' || to_char(b.expiry_date,'DD Mon YYYY'),
           b.quantity || ' left',
           '/pharmacy/stock'
    from public.medicine_batches b
    join public.medicine_directory m on m.id = b.medicine_id
    where b.active
      and (
        (p_metric = 'low_stock' and b.quantity between 1 and b.low_stock_threshold)
        or (p_metric = 'out_of_stock' and b.quantity = 0)
        or (p_metric = 'expiring_soon' and b.quantity > 0 and b.expiry_date between current_date and current_date + 30)
      )
    order by b.expiry_date
    limit v_limit;

  elsif p_metric = 'dispensed_today' then
    return query
    select p.name,
           'Sale at ' || to_char(s.created_at at time zone 'Asia/Kolkata','HH12:MI AM'),
           to_char(s.total_paise / 100.0, 'FM999999990.00'),
           '/pharmacy/sales'
    from public.pharmacy_sales s
    join public.patients p on p.id = s.patient_id
    where (s.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by s.created_at desc
    limit v_limit;

  elsif p_metric = 'reports_ready' then
    return query
    select p.name, r.report_name, replace(r.status::text,'_',' '), '/reports'
    from public.patient_reports r
    join public.patients p on p.id = r.patient_id
    where r.status = 'ready'
    order by r.created_at desc
    limit v_limit;

  elsif p_metric = 'reports_pending' then
    return query
    select p.name, o.test_name, replace(o.status::text,'_',' '), '/reports'
    from public.test_orders o
    join public.patients p on p.id = o.patient_id
    where o.status in ('ordered','report_pending')
      and (v_role <> 'doctor' or o.doctor_id = v_doctor)
    order by o.created_at desc
    limit v_limit;

  elsif p_metric = 'followups_due' then
    return query
    select p.name,
           coalesce(c.assessment, 'Follow-up'),
           replace(c.follow_up_type::text,'_',' '),
           '/visits/' || c.visit_id
    from public.consultations c
    join public.visits v on v.id = c.visit_id
    join public.patients p on p.id = v.patient_id
    where c.follow_up_type <> 'none' and c.status = 'completed'
      and (c.follow_up_date is null or c.follow_up_date <= v_today)
      and (v_role <> 'doctor' or c.doctor_id = v_doctor)
    order by c.completed_at desc
    limit v_limit;

  elsif p_metric in ('op_collection_paise','collected_today_paise') then
    return query
    select p.name,
           'Token #' || v.token_number || ' · ' || replace(vp.mode::text,'_',' '),
           to_char(vp.amount_paise / 100.0, 'FM999999990.00'),
           '/visits/' || v.id
    from public.visit_payments vp
    join public.visits v on v.id = vp.visit_id
    join public.patients p on p.id = v.patient_id
    where (vp.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by vp.created_at desc
    limit v_limit;

  elsif p_metric in ('ip_collection_paise','ip_balance_paise') then
    return query
    select coalesce(p.name,'Unidentified emergency'),
           t.ticket_number,
           to_char(
             greatest(0,
               coalesce((select sum(ch.amount_paise) from public.ip_charges ch where ch.ip_ticket_id = t.id),0)
               - coalesce((select sum(pa.amount_paise) from public.ip_payments pa where pa.ip_ticket_id = t.id),0)
             ) / 100.0, 'FM999999990.00'),
           '/ip/' || t.id
    from public.ip_tickets t
    left join public.patients p on p.id = t.patient_id
    where t.status in ('admitted','discharge_pending')
    order by t.admission_at
    limit v_limit;

  elsif p_metric = 'pharmacy_sales_today_paise' then
    return query
    select p.name,
           to_char(s.created_at at time zone 'Asia/Kolkata','HH12:MI AM') || ' · ' || upper(s.source::text),
           to_char(s.total_paise / 100.0, 'FM999999990.00'),
           '/pharmacy/sales'
    from public.pharmacy_sales s
    join public.patients p on p.id = s.patient_id
    where (s.created_at at time zone 'Asia/Kolkata')::date = v_today
    order by s.created_at desc
    limit v_limit;
  end if;

  return;
end $$;

revoke all on function public.dashboard_metric_detail(text,integer) from public;
grant execute on function public.dashboard_metric_detail(text,integer) to authenticated;

commit;
