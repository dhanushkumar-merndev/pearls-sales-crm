-- Per-staff activity for Admin -> Analytics.
--
-- The hospital owner wants to see what each member of staff actually did in a
-- period: who registered patients, who recorded vitals, who collected money,
-- who dispensed, who admitted and discharged. Every one of these numbers
-- already exists as an actor column on the row that was written; this pulls
-- them together in one server-side aggregate rather than shipping rows to the
-- browser to be counted there (AGENTS.md 40).
--
-- Deliberately counts WORK DONE, never clinical quality. There is no score, no
-- ranking and no revenue-per-doctor: AGENTS.md 40 forbids medically misleading
-- performance measures, and a doctor who sees fewer, sicker patients is not
-- doing less.
begin;

create or replace function public.report_staff_activity(p_from date, p_to date)
returns table(
  profile_id uuid,
  full_name text,
  role text,
  status text,
  patients_registered bigint,
  visits_created bigint,
  vitals_recorded bigint,
  consultations_completed bigint,
  prescriptions_written bigint,
  tests_ordered bigint,
  reports_uploaded bigint,
  op_payments_count bigint,
  op_payments_paise bigint,
  ip_admissions bigint,
  ip_discharges bigint,
  ip_charges_added bigint,
  ip_charges_paise bigint,
  ip_payments_count bigint,
  ip_payments_paise bigint,
  progress_notes bigint,
  dispenses bigint,
  dispensed_paise bigint,
  stock_movements bigint,
  audited_actions bigint,
  last_action_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_to timestamptz;
begin
  if public.current_app_role() is null or public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid date range';
  end if;
  -- Hospital days, not UTC days: a 9 pm admission belongs to that evening.
  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  return query
  select
    p.id,
    p.full_name,
    p.role::text,
    p.status::text,
    (select count(*) from public.patients x
       where x.created_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.visits x
       where x.created_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.vitals x
       where x.recorded_by = p.id and x.recorded_at >= v_from and x.recorded_at < v_to),
    -- Clinical work is attributed through the linked doctor record, because the
    -- clinical tables carry doctor_id rather than a user id.
    (select count(*) from public.consultations x
       where p.doctor_id is not null and x.doctor_id = p.doctor_id
         and x.status = 'completed' and x.completed_at >= v_from and x.completed_at < v_to),
    (select count(*) from public.prescriptions x
       where p.doctor_id is not null and x.doctor_id = p.doctor_id
         and x.status <> 'draft' and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.test_orders x
       where p.doctor_id is not null and x.doctor_id = p.doctor_id
         and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.patient_reports x
       where x.uploaded_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.visit_payments x
       where x.collected_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.amount_paise),0)::bigint from public.visit_payments x
       where x.collected_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.ip_tickets x
       where x.created_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    -- Discharge is not stamped with an actor, so it is read from the audit log,
    -- which is where the person who completed it is recorded.
    (select count(*) from public.audit_logs x
       where x.actor_user_id = p.id and x.action = 'IP_DISCHARGED'
         and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.ip_charges x
       where x.added_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.amount_paise),0)::bigint from public.ip_charges x
       where x.added_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.ip_payments x
       where x.collected_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.amount_paise),0)::bigint from public.ip_payments x
       where x.collected_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.ip_progress_notes x
       where p.doctor_id is not null and x.doctor_id = p.doctor_id
         and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.pharmacy_sales x
       where x.dispensed_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select coalesce(sum(x.total_paise),0)::bigint from public.pharmacy_sales x
       where x.dispensed_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.stock_movements x
       where x.created_by = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select count(*) from public.audit_logs x
       where x.actor_user_id = p.id and x.created_at >= v_from and x.created_at < v_to),
    (select max(x.created_at) from public.audit_logs x
       where x.actor_user_id = p.id and x.created_at >= v_from and x.created_at < v_to)
  from public.profiles p
  order by p.role, p.full_name;
end $$;

revoke all on function public.report_staff_activity(date,date) from public, anon;
grant execute on function public.report_staff_activity(date,date) to authenticated, service_role;

commit;
