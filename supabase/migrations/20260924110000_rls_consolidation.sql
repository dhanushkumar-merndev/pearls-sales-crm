-- Pearl Aesthetic CRM: one authoritative RLS matrix.
--
-- Roles: admin, reception, op, doctor, pharmacy, sales_executive (the old
-- `ip` value stays in the enum only because Postgres cannot drop it).
--
-- Rather than patching the ~70 policies accumulated over 130 migrations, every
-- policy in `public` (and this app's storage policies) is dropped and rebuilt
-- here from a single matrix:
--
--   * One permissive policy per table per command -- no overlapping SELECT +
--     FOR ALL pairs that Postgres would have to OR together on every read.
--   * `current_app_role()`, `current_doctor_id()` and `auth.uid()` are always
--     wrapped in `(select ...)` so they are evaluated once per statement, not
--     once per row.
--   * `current_app_role()` is NULL for anyone without an active profile, so a
--     deactivated account matches no policy at all (no more `using (true)`).
--   * Write policies exist only where the app writes with the user's own
--     session. Every clinical, pharmacy and lead write goes through a
--     SECURITY DEFINER RPC that performs its own role checks, so those tables
--     carry no INSERT/UPDATE policy. No table has a DELETE policy: nothing is
--     hard-deleted by staff (history is archived/voided instead).

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
       or (schemaname = 'storage' and tablename = 'objects'
           and policyname in ('patient_documents_read', 'patient_documents_upload', 'exports_storage_admin'))
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Staff & configuration
-- ---------------------------------------------------------------------------

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.current_app_role()) = 'admin');
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- Masters every active staff member reads (letterhead, categories, departments).
create policy departments_read on public.departments for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy departments_admin_insert on public.departments for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy departments_admin_update on public.departments for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy report_categories_read on public.report_categories for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy report_categories_admin_insert on public.report_categories for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy report_categories_admin_update on public.report_categories for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy hospital_settings_read on public.hospital_settings for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy hospital_settings_admin_insert on public.hospital_settings for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy hospital_settings_admin_update on public.hospital_settings for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- Doctor fees and the clinic price list are not for the lead desk.
create policy doctors_read on public.doctors for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor', 'pharmacy'));
create policy doctors_admin_insert on public.doctors for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy doctors_admin_update on public.doctors for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy charges_read on public.charges for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor', 'pharmacy'));
create policy charges_admin_insert on public.charges for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy charges_admin_update on public.charges for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using ((select public.current_app_role()) = 'admin');

create policy export_jobs_admin_read on public.export_jobs for select to authenticated
  using ((select public.current_app_role()) = 'admin');

create policy notification_reads_own_select on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_reads_own_insert on public.notification_reads for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_reads_own_update on public.notification_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Clinical directory (local autocomplete)
-- ---------------------------------------------------------------------------

create policy clinical_terms_read on public.clinical_terms for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor', 'pharmacy')
    and (active or (select public.current_app_role()) = 'admin')
  );
create policy clinical_terms_admin_insert on public.clinical_terms for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy clinical_terms_admin_update on public.clinical_terms for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy clinical_term_catalog_admin_read on public.clinical_term_catalog_memberships
  for select to authenticated using ((select public.current_app_role()) = 'admin');
create policy snomed_concepts_admin_read on public.snomed_concepts
  for select to authenticated using ((select public.current_app_role()) = 'admin');
create policy snomed_releases_admin_read on public.snomed_releases
  for select to authenticated using ((select public.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Patients & OP workflow
-- ---------------------------------------------------------------------------

-- Pharmacy sees only patients whose prescriptions it is dispensing.
create policy patients_read on public.patients for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
    or (
      (select public.current_app_role()) = 'pharmacy'
      and exists (
        select 1 from public.visits v
        where v.patient_id = patients.id and public.pharmacy_may_view_visit(v.id)
      )
    )
  );
-- Reception owns the patient register.
create policy patients_front_desk_insert on public.patients for insert to authenticated
  with check ((select public.current_app_role()) in ('admin', 'reception'));
create policy patients_front_desk_update on public.patients for update to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception'))
  with check ((select public.current_app_role()) in ('admin', 'reception'));

create policy visits_read on public.visits for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
    or ((select public.current_app_role()) = 'pharmacy' and public.pharmacy_may_view_visit(id))
  );

-- Money: admin and the front desk only. OP and doctors never see payments.
create policy visit_payments_read on public.visit_payments for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception'));
create policy visit_payments_insert on public.visit_payments for insert to authenticated
  with check ((select public.current_app_role()) in ('admin', 'reception'));

create policy vitals_read on public.vitals for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
    or ((select public.current_app_role()) = 'pharmacy' and public.pharmacy_may_view_visit(visit_id))
  );

create policy consultations_read on public.consultations for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
    or ((select public.current_app_role()) = 'pharmacy' and public.pharmacy_may_view_visit(visit_id))
  );

create policy consultation_diagnoses_read on public.consultation_diagnoses for select to authenticated
  using (exists (select 1 from public.consultations c where c.id = consultation_diagnoses.consultation_id));

create policy test_orders_read on public.test_orders for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
    or (
      (select public.current_app_role()) = 'pharmacy'
      and visit_id is not null and public.pharmacy_may_view_visit(visit_id)
    )
  );

create policy patient_reports_read on public.patient_reports for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor'));
create policy patient_reports_upload on public.patient_reports for insert to authenticated
  with check ((select public.current_app_role()) in ('admin', 'reception', 'op'));

create policy prescriptions_read on public.prescriptions for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'reception', 'doctor', 'pharmacy'));
create policy prescription_items_read on public.prescription_items for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_items.prescription_id));

-- ---------------------------------------------------------------------------
-- Pharmacy
-- ---------------------------------------------------------------------------

create policy medicine_directory_read on public.medicine_directory for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor', 'pharmacy')
    and (active or (select public.current_app_role()) in ('admin', 'pharmacy'))
  );
create policy medicine_directory_manage_insert on public.medicine_directory for insert to authenticated
  with check ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy medicine_directory_manage_update on public.medicine_directory for update to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'))
  with check ((select public.current_app_role()) in ('admin', 'pharmacy'));

-- Table-level SELECT on batches is revoked (column security); availability
-- is read through RPCs. This keeps direct reads consistent if it is regranted.
create policy medicine_batches_read on public.medicine_batches for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'doctor', 'pharmacy'));
create policy medicine_batches_manage_update on public.medicine_batches for update to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'))
  with check ((select public.current_app_role()) in ('admin', 'pharmacy'));

create policy medicine_field_options_read on public.medicine_field_options for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy', 'doctor'));

create policy inventory_items_read on public.inventory_items for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy stock_movements_read on public.stock_movements for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy inventory_stock_movements_read on public.inventory_stock_movements for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy pharmacy_sales_read on public.pharmacy_sales for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy pharmacy_sale_items_read on public.pharmacy_sale_items for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy procedure_sales_read on public.procedure_sales for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy procedure_sale_items_read on public.procedure_sale_items for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy bulk_import_jobs_read on public.bulk_import_jobs for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));
create policy bulk_import_errors_read on public.bulk_import_errors for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'pharmacy'));

-- ---------------------------------------------------------------------------
-- Leads CRM & Meta
-- ---------------------------------------------------------------------------

-- A sales executive sees only the leads assigned to them. Reception reaches
-- booked appointments through list_lead_appointments(), never the table.
create policy leads_read on public.leads for select to authenticated
  using (
    (select public.current_app_role()) = 'admin'
    or ((select public.current_app_role()) = 'sales_executive' and assigned_to = (select auth.uid()))
  );
create policy lead_activities_read on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_activities.lead_id));

create policy meta_integration_admin_read on public.meta_integration for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy meta_pages_admin_read on public.meta_pages for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy meta_lead_forms_admin_read on public.meta_lead_forms for select to authenticated
  using ((select public.current_app_role()) = 'admin');
-- meta_integration_secrets, meta_page_secrets: RLS on, no policy, no grant.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

create policy patient_documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and (select public.current_app_role()) in ('admin', 'reception', 'op', 'doctor')
  );
create policy patient_documents_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (select public.current_app_role()) in ('admin', 'reception', 'op')
  );
-- Monthly exports are generated and served by the server with the service
-- role; an admin session may list them but nobody writes them directly.
create policy exports_storage_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'hospital-exports' and (select public.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Table privileges: RLS never applies to TRUNCATE, and nothing in the app
-- needs TRUNCATE/TRIGGER/REFERENCES from an API role.
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.relname);
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;
