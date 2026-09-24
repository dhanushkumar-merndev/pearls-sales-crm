-- Pharmacy's view of a patient is deliberately narrow and time-bound
-- (20260819090000): they see a visit only while they have business with it,
-- never the whole register. Two gaps in that model made every prescription
-- print 404 for the pharmacy role:
--
--   1. IP prescriptions have no visit at all -- visit_id is null and
--      ip_ticket_id is set -- and pharmacy could not see ip_tickets, so the
--      embedded patient came back null and the page called notFound().
--   2. pharmacy_may_view_visit drops a visit the moment its prescription is
--      fully dispensed, but the pharmacy list keeps offering "Prescription"
--      and "Receipt" on closed rows. Reprinting a slip for a sale you made an
--      hour ago is exactly when a patient asks for it.
--
-- Both are closed the same way the original was written: by widening what
-- counts as "business with it", not by handing pharmacy blanket table access.
begin;

-- A visit pharmacy actually dispensed against stays visible for reprints.
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
        or exists(
          select 1
          from public.prescriptions p
          join public.pharmacy_sales s on s.prescription_id = p.id
          where p.visit_id = v.id
        )
      )
  );
$$;

-- The IP equivalent: a ward ticket pharmacy is dispensing for, has dispensed
-- for, or has an item request against.
create or replace function public.pharmacy_may_view_ip_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.ip_tickets t
    where t.id = p_ticket_id
      and (
        exists(
          select 1 from public.prescriptions p
          where p.ip_ticket_id = t.id
            and (
              p.status in ('pending','partially_dispensed')
              or exists(
                select 1 from public.pharmacy_sales s where s.prescription_id = p.id
              )
            )
        )
        or exists(
          select 1 from public.ip_inventory_requests r where r.ip_ticket_id = t.id
        )
      )
  );
$$;

revoke all on function public.pharmacy_may_view_ip_ticket(uuid) from public, anon;
grant execute on function public.pharmacy_may_view_ip_ticket(uuid) to authenticated;

-- These predicates run per row, so the exists() lookups need to be index
-- scans rather than sequential ones once the tables are large.
create index if not exists prescriptions_visit_idx on public.prescriptions (visit_id);
create index if not exists prescriptions_ip_ticket_idx on public.prescriptions (ip_ticket_id);
create index if not exists pharmacy_sales_prescription_idx on public.pharmacy_sales (prescription_id);
create index if not exists ip_inventory_requests_ticket_idx on public.ip_inventory_requests (ip_ticket_id);

-- ip_tickets: replace the blanket pharmacy grant with the narrow predicate.
drop policy if exists "ip_read" on public.ip_tickets;
create policy "ip_read" on public.ip_tickets for select to authenticated
  using (
    (select public.current_app_role()) = any (array['admin','ip']::public.app_role[])
    or ((select public.current_app_role()) = 'doctor'::public.app_role
        and doctor_id = (select public.current_doctor_id()))
    or ((select public.current_app_role()) = 'pharmacy'::public.app_role
        and public.pharmacy_may_view_ip_ticket(id))
  );

-- patients: reachable through a visit pharmacy may view (unchanged) or now
-- through an IP ticket they may view.
drop policy if exists clinical_roles_patients_read on public.patients;
create policy clinical_roles_patients_read on public.patients for select to authenticated
  using (
    (select public.current_app_role()) = any (array['admin','reception','op','doctor','ip']::public.app_role[])
    or (
      (select public.current_app_role()) = 'pharmacy'::public.app_role
      and (
        exists(
          select 1 from public.visits v
          where v.patient_id = patients.id and public.pharmacy_may_view_visit(v.id)
        )
        or exists(
          select 1 from public.ip_tickets t
          where t.patient_id = patients.id and public.pharmacy_may_view_ip_ticket(t.id)
        )
      )
    )
  );

commit;
