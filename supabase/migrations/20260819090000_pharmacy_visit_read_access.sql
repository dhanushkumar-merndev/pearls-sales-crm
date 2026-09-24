-- Pharmacy can already WRITE a consultation on a doctor's behalf
-- (save_visit_consultation / start_visit_consultation, both security-definer
-- RPCs added in 20260818220000_pharmacy_consultation_entry.sql), but every
-- SELECT RLS policy on visits/patients/vitals/consultations/test_orders still
-- excludes 'pharmacy'. Two real pages break as a result, both opened in a new
-- tab and both rendering blank/not-found for the pharmacy role:
--   * /visits/[id] -- "Open Consultation" from the manual-prescription dialog
--     (Enter Doctor's Prescription) queries public.visits directly; RLS hides
--     the row entirely, so the page 404s before the form ever renders.
--   * /print/prescription/[id] -- reachable straight after dispensing; the
--     prescriptions row is visible (prescriptions_read already allows
--     pharmacy) but the embedded visits->patients/vitals/consultations join
--     comes back null under RLS, so the printed slip is missing the patient's
--     name and the rest of the visit detail.
--
-- Scoped narrowly rather than handed the same blanket table access as
-- reception/OP/IP: pharmacy can only see a visit it has actual business with
-- -- one still open for consultation entry, or one carrying a prescription
-- pharmacy still needs to dispense/reprint. A visit drops out of view again
-- once its prescription is fully dispensed, cancelled or expired, the same
-- "narrow and time-bound, not the whole patient register" principle
-- list_pending_prescriptions already applies (20260815110000).
begin;

create or replace function public.pharmacy_may_view_visit(p_visit_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.visits v
    where v.id = p_visit_id
      and v.status <> 'cancelled'
      and (
        not exists(
          select 1 from public.consultations c
          where c.visit_id = v.id and c.status = 'completed'
        )
        or exists(
          select 1 from public.prescriptions p
          where p.visit_id = v.id and p.status in ('pending','partially_dispensed')
        )
      )
  );
$$;

revoke all on function public.pharmacy_may_view_visit(uuid) from public, anon;
grant execute on function public.pharmacy_may_view_visit(uuid) to authenticated;

drop policy if exists visits_read on public.visits;
create policy visits_read on public.visits for select to authenticated
  using(
    public.current_app_role() in ('admin','reception','op','ip','doctor')
    or (public.current_app_role()='pharmacy' and public.pharmacy_may_view_visit(id))
  );

drop policy if exists clinical_roles_patients_read on public.patients;
create policy clinical_roles_patients_read on public.patients for select to authenticated
  using(
    public.current_app_role() in ('admin','reception','op','doctor','ip')
    or (
      public.current_app_role()='pharmacy'
      and exists(
        select 1 from public.visits v
        where v.patient_id = patients.id and public.pharmacy_may_view_visit(v.id)
      )
    )
  );

drop policy if exists vitals_read on public.vitals;
create policy vitals_read on public.vitals for select to authenticated
  using(
    public.current_app_role() in ('admin','reception','op','doctor','ip')
    or (public.current_app_role()='pharmacy' and public.pharmacy_may_view_visit(visit_id))
  );

drop policy if exists consultations_read on public.consultations;
create policy consultations_read on public.consultations for select to authenticated
  using(
    public.current_app_role() in ('admin','doctor','op','ip','reception')
    or (public.current_app_role()='pharmacy' and public.pharmacy_may_view_visit(visit_id))
  );

drop policy if exists tests_read on public.test_orders;
create policy tests_read on public.test_orders for select to authenticated
  using(
    public.current_app_role() in ('admin','reception','op','doctor','ip')
    or (
      public.current_app_role()='pharmacy'
      and visit_id is not null
      and public.pharmacy_may_view_visit(visit_id)
    )
  );

commit;
