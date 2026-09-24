-- "Today" is computed as (created_at AT TIME ZONE 'Asia/Kolkata')::date across
-- dashboard_summary, dashboard_metric_detail and several pages. A plain btree on
-- created_at cannot serve that predicate, so every one of those queries was a
-- sequential scan -- confirmed with EXPLAIN ANALYZE on all five tables.
--
-- It is invisible at 100 patients (sub-millisecond, and Postgres correctly
-- prefers a seq scan on a tiny table), but the cost grows linearly with row
-- count and these run on every dashboard load for every signed-in user.
--
-- The expression is IMMUTABLE (timezone() with a literal zone, then a date
-- cast), so it can be indexed directly. Postgres will switch to these once the
-- tables are large enough for the index to win.
begin;

create index if not exists patients_registered_day_idx
  on public.patients (((created_at at time zone 'Asia/Kolkata')::date));

create index if not exists visit_payments_collected_day_idx
  on public.visit_payments (((created_at at time zone 'Asia/Kolkata')::date));

create index if not exists pharmacy_sales_day_idx
  on public.pharmacy_sales (((created_at at time zone 'Asia/Kolkata')::date));

create index if not exists ip_tickets_admission_day_idx
  on public.ip_tickets (((admission_at at time zone 'Asia/Kolkata')::date));

create index if not exists ip_tickets_discharge_day_idx
  on public.ip_tickets (((discharge_at at time zone 'Asia/Kolkata')::date))
  where discharge_at is not null;

create index if not exists ip_payments_collected_day_idx
  on public.ip_payments (((created_at at time zone 'Asia/Kolkata')::date));

create index if not exists procedure_sales_day_idx
  on public.procedure_sales (((created_at at time zone 'Asia/Kolkata')::date));

-- visits.visit_date is a plain date column, but the existing indexes both lead
-- with doctor_id, so hospital-wide "today" queries could not use them.
create index if not exists visits_visit_date_idx
  on public.visits (visit_date, status);

-- Drill-down list ordering.
create index if not exists prescriptions_pending_idx
  on public.prescriptions (created_at)
  where status in ('pending','partially_dispensed');

analyze public.patients;
analyze public.visits;
analyze public.visit_payments;
analyze public.pharmacy_sales;
analyze public.ip_tickets;

commit;
