-- Production query hardening for the high-frequency application paths.
--
-- The indexes below are deliberately aligned with predicates already used by
-- route handlers/pages and by operational_data_signature().  They are not a
-- speculative index on every foreign key: each one removes an observed
-- sequential scan shape from a live list, alert, or polling query.
begin;

create extension if not exists pg_trgm with schema extensions;

-- Empty patient-directory pages are ordered newest first. Prefix search keeps
-- using the existing phone/name/UHID indexes; the trigram index supports the
-- intentional contains-name searches in reports and pharmacy RPCs.
create index if not exists patients_created_at_idx
  on public.patients (created_at desc);
create index if not exists patients_name_trgm_idx
  on public.patients using gin (name extensions.gin_trgm_ops);
create index if not exists ip_tickets_number_trgm_idx
  on public.ip_tickets using gin (ticket_number extensions.gin_trgm_ops);
create index if not exists visit_payments_reference_trgm_idx
  on public.visit_payments using gin (reference extensions.gin_trgm_ops)
  where reference is not null;
create index if not exists audit_logs_action_trgm_idx
  on public.audit_logs using gin (action extensions.gin_trgm_ops);
create index if not exists audit_logs_entity_type_trgm_idx
  on public.audit_logs using gin (entity_type extensions.gin_trgm_ops)
  where entity_type is not null;

-- Global operational lists. Existing patient/visit-specific indexes remain in
-- place for history screens.
create index if not exists patient_reports_created_idx
  on public.patient_reports (created_at desc);
create index if not exists patient_reports_status_created_idx
  on public.patient_reports (status, created_at desc);
create index if not exists patient_reports_name_trgm_idx
  on public.patient_reports using gin (report_name extensions.gin_trgm_ops);
create index if not exists patient_reports_display_name_trgm_idx
  on public.patient_reports using gin (display_name extensions.gin_trgm_ops);
create index if not exists test_orders_pending_created_idx
  on public.test_orders (created_at desc)
  where status in ('ordered', 'report_pending');
create index if not exists test_orders_visit_idx
  on public.test_orders (visit_id)
  where visit_id is not null;
create index if not exists test_orders_ip_ticket_idx
  on public.test_orders (ip_ticket_id)
  where ip_ticket_id is not null;
create index if not exists consultations_followup_due_idx
  on public.consultations (follow_up_date, completed_at desc)
  where status = 'completed' and follow_up_type <> 'none';
create index if not exists ip_tickets_active_admission_idx
  on public.ip_tickets (admission_at desc)
  where status in ('admitted', 'discharge_pending');
create index if not exists ip_tickets_source_visit_idx
  on public.ip_tickets (source_visit_id)
  where source_visit_id is not null;
create index if not exists prescriptions_ip_ticket_idx
  on public.prescriptions (ip_ticket_id)
  where ip_ticket_id is not null;
create index if not exists pharmacy_sales_ip_ticket_idx
  on public.pharmacy_sales (ip_ticket_id)
  where ip_ticket_id is not null;
create index if not exists medicine_batches_expiry_alert_idx
  on public.medicine_batches (expiry_date)
  where active and quantity > 0;
create index if not exists medicine_batches_number_search_idx
  on public.medicine_batches (lower(batch_number) text_pattern_ops);
create index if not exists clinical_terms_normalized_trgm_idx
  on public.clinical_terms using gin (normalized_text extensions.gin_trgm_ops)
  where active;
create index if not exists clinical_terms_display_trgm_idx
  on public.clinical_terms using gin (display_text extensions.gin_trgm_ops);
create index if not exists consultations_assessment_trgm_idx
  on public.consultations using gin (assessment extensions.gin_trgm_ops)
  where assessment is not null;
create index if not exists inventory_items_search_trgm_idx
  on public.inventory_items using gin (search_text extensions.gin_trgm_ops)
  where active;

-- /api/live/version is polled while an operational screen is open. PostgreSQL
-- can answer max(timestamp) with these indexes instead of repeatedly scanning
-- each growing table.
create index if not exists visits_updated_idx on public.visits (updated_at desc);
create index if not exists visit_payments_created_idx on public.visit_payments (created_at desc);
create index if not exists vitals_updated_idx on public.vitals (updated_at desc);
create index if not exists consultations_updated_idx on public.consultations (updated_at desc);
create index if not exists consultations_doctor_updated_idx on public.consultations (doctor_id, updated_at desc);
create index if not exists patient_reports_updated_idx on public.patient_reports (updated_at desc);
create index if not exists ip_tickets_updated_idx on public.ip_tickets (updated_at desc);
create index if not exists ip_tickets_doctor_updated_idx on public.ip_tickets (doctor_id, updated_at desc);
create index if not exists ip_charges_created_idx on public.ip_charges (created_at desc);
create index if not exists ip_payments_created_idx on public.ip_payments (created_at desc);
create index if not exists prescriptions_updated_idx on public.prescriptions (updated_at desc);
create index if not exists medicine_batches_updated_idx on public.medicine_batches (updated_at desc);

-- One bounded, parameterized patient query is shared by autocomplete, queue
-- filtering, and the paginated directory. It avoids the former OR between an
-- indexed phone prefix and an unindexed "%UHID digits%" predicate. Visit totals
-- are calculated only for the returned page, using visits_patient_history_idx.
create or replace function public.list_patients(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_include_visit_count boolean default false,
  p_active_only boolean default false
)
returns table(
  id uuid,
  name text,
  uhid text,
  phone_normalized text,
  dob date,
  gender text,
  status text,
  created_at timestamptz,
  visit_count bigint,
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
  v_uhid_query text;
  v_limit integer;
  v_offset integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','reception','op','doctor','ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  v_uhid_query := case
    when v_query ~ '^mh-?[0-9]+' then 'mh-' || v_digits
    else v_query
  end;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := least(greatest(coalesce(p_offset, 0), 0), 100000);

  return query
  with filtered as (
    select
      p.id,
      p.name,
      p.uhid,
      p.phone_normalized,
      p.dob,
      p.gender::text as gender,
      p.status::text as status,
      p.created_at,
      p.name_normalized,
      count(*) over () as total_count,
      case
        when v_query = '' then 0
        when lower(p.uhid) = v_uhid_query then 0
        when p.phone_normalized = right(v_digits, 10) then 0
        when p.phone_normalized like right(v_digits, 10) || '%' then 1
        when lower(p.uhid) like 'mh-' || v_digits || '%' then 2
        else 3
      end as relevance
    from public.patients p
    where
      (not p_active_only or p.status = 'active')
      and (
        v_query = ''
        or (
          v_query ~ '^mh-?[0-9]+'
          and lower(p.uhid) like v_uhid_query || '%'
        )
        or (
          v_query ~ '^[0-9+() -]+$'
          and v_digits <> ''
          and (
            p.phone_normalized like right(v_digits, 10) || '%'
            or lower(p.uhid) like 'mh-' || v_digits || '%'
          )
        )
        or (
          v_query !~ '^[0-9+() -]+$'
          and v_query !~ '^mh-?[0-9]+'
          and p.name_normalized like v_query || '%'
        )
      )
  ), paged as (
    select f.*
    from filtered f
    order by
      f.relevance,
      case when v_query = '' then f.created_at end desc,
      f.name_normalized,
      f.id
    limit v_limit
    offset v_offset
  )
  select
    p.id,
    p.name,
    p.uhid,
    p.phone_normalized,
    p.dob,
    p.gender,
    p.status,
    p.created_at,
    coalesce(v.visit_count, 0)::bigint,
    p.total_count
  from paged p
  left join lateral (
    select count(*)::bigint as visit_count
    from public.visits visit
    where p_include_visit_count and visit.patient_id = p.id
  ) v on true
  order by
    p.relevance,
    case when v_query = '' then p.created_at end desc,
    p.name_normalized,
    p.id;
end
$$;

revoke all on function public.list_patients(text, integer, integer, boolean, boolean) from public, anon;
grant execute on function public.list_patients(text, integer, integer, boolean, boolean) to authenticated, service_role;

-- IP list rows formerly embedded every charge and payment record and summed
-- them in React. Return one aggregate row per visible ticket instead, bounded
-- to one UI page. This keeps payload size constant as a long admission accrues
-- hundreds of ledger entries.
create or replace function public.get_ip_financial_summaries(p_ticket_ids uuid[])
returns table(
  ticket_id uuid,
  total_paise bigint,
  paid_paise bigint,
  balance_paise bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ticket_ids), 0) > 100 then
    raise exception 'too many tickets' using errcode = '22023';
  end if;

  return query
  select
    requested.ticket_id,
    coalesce(charges.total_paise, 0)::bigint,
    coalesce(payments.paid_paise, 0)::bigint,
    greatest(
      0,
      coalesce(charges.total_paise, 0) - coalesce(payments.paid_paise, 0)
    )::bigint
  from unnest(coalesce(p_ticket_ids, array[]::uuid[])) as requested(ticket_id)
  left join lateral (
    select sum(charge.amount_paise)::bigint as total_paise
    from public.ip_charges charge
    where charge.ip_ticket_id = requested.ticket_id
  ) charges on true
  left join lateral (
    select sum(payment.amount_paise)::bigint as paid_paise
    from public.ip_payments payment
    where payment.ip_ticket_id = requested.ticket_id
  ) payments on true;
end
$$;

revoke all on function public.get_ip_financial_summaries(uuid[]) from public, anon;
grant execute on function public.get_ip_financial_summaries(uuid[]) to authenticated, service_role;

-- Keep phone lookup as an indexed prefix. The previous leading-wildcard form
-- scanned every historical sale even when the cashier entered a full phone.
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
  with matched as (
    select
      sale.id,
      sale.created_at,
      sale.source::text as source,
      sale.total_paise,
      patient.name as patient_name,
      patient.phone_normalized as patient_phone,
      profile.full_name as dispensed_by,
      (
        select count(*)
        from public.pharmacy_sale_items item
        where item.sale_id = sale.id
      ) as item_count
    from public.pharmacy_sales sale
    left join public.patients patient on patient.id = sale.patient_id
    left join public.profiles profile on profile.id = sale.dispensed_by
    where v_query is null
       or patient.name ilike '%' || v_query || '%'
       or (v_digits <> '' and patient.phone_normalized like right(v_digits, 10) || '%')
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

revoke all on function public.list_pharmacy_sales(text, integer, integer) from public, anon;
grant execute on function public.list_pharmacy_sales(text, integer, integer) to authenticated, service_role;

-- dashboard_metric_detail is SECURITY DEFINER. Its original implementation
-- protected money, but an authenticated role could request unrelated clinical
-- metrics directly. Keep the existing implementation internal and put a strict
-- role/metric allow-list in front of it. Doctor report rows are handled here so
-- they are scoped to that doctor's visits/orders/IP tickets.
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
      'waiting','vitals_pending','ready','completed','reports_pending'
    ]))
    or (v_role = 'doctor' and p_metric = any(array[
      'waiting','ready','completed','followups_due','reports_ready','current_ip'
    ]))
    or (v_role = 'ip' and p_metric = any(array[
      'current_ip','admissions_today','discharges_today','discharge_pending','ip_balance_paise'
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

revoke all on function public.dashboard_metric_detail(text, integer) from public, anon, authenticated;
revoke all on function public.dashboard_metric_detail_for_role(text, integer) from public, anon;
grant execute on function public.dashboard_metric_detail_for_role(text, integer) to authenticated, service_role;

-- An inactive authenticated account has current_app_role() = NULL. The former
-- SQL summary still returned global, non-role-filtered counters in that case.
-- Preserve its already-tested metric calculations as an internal function and
-- add a NULL-safe gate at the public entry point.
alter function public.dashboard_summary() rename to dashboard_summary_internal;
revoke all on function public.dashboard_summary_internal() from public, anon, authenticated;

create function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.dashboard_summary_internal();
end
$$;

revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated, service_role;

analyze public.patients;
analyze public.visits;
analyze public.patient_reports;
analyze public.test_orders;
analyze public.consultations;
analyze public.ip_tickets;
analyze public.medicine_batches;

commit;
