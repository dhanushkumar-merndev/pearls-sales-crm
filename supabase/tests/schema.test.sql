begin;
select no_plan();
select has_table('public','patients','patients table exists');
select has_table('public','visits','visits table exists');
select has_table('public','medicine_batches','stock table exists');
select has_table('public','notification_reads','persistent notification read state exists');
select has_function('public','create_visit_with_token',array['uuid','uuid','visit_type','bigint','bigint','payment_mode','uuid','text','uuid'],'atomic visit RPC exists');
select has_function('public','dispense_prescription',array['uuid','jsonb','payment_mode','uuid','bigint'],'atomic dispense RPC exists');
select has_function('public','expire_stale_prescriptions',array[]::text[],'24-hour prescription expiry workflow exists');
select has_function('public','record_visit_vitals',array['uuid','numeric','numeric','numeric','smallint','smallint','smallint','smallint','smallint','text'],'vitals workflow RPC exists');
select has_column('public','vitals','temperature_f','vitals store temperature in Fahrenheit');
select hasnt_column('public','vitals','temperature_c','legacy Celsius vitals column is removed');
select col_has_check('public','vitals','temperature_f','Fahrenheit temperature has a valid range check');
select has_function('public','save_visit_consultation',array['uuid','text','text','text','text','text','follow_up_type','date','integer','jsonb','jsonb','boolean','bigint','jsonb'],'consultation workflow RPC exists');
select hasnt_table('public','ip_tickets','IP tickets are removed');
select hasnt_table('public','room_beds','room and bed management is removed');
select hasnt_column('public','doctors','ip_visit_fee_paise','IP doctor fee is removed');
select has_table('public','leads','leads CRM exists');
select has_table('public','lead_activities','lead activity trail exists');
select has_trigger('public','visits','convert_booked_lead_on_visit','reception visit creation converts the booking');
select has_function('public','create_manual_lead',array['text','text','text','text','text','text','uuid','uuid'],'manual enquiries use a controlled RPC');
select has_function('public','convert_lead',array['uuid','timestamp with time zone','uuid','text','text','text'],'booking creates or links a patient');
select has_trigger('public','consultations','protect_completed_consultation','completed consultations are immutable');
select has_trigger('public','prescription_items','protect_prescription_content','completed prescription content is immutable');
select has_trigger('public','visit_payments','prevent_visit_overpayment','visit overpayment is blocked');
select has_function('public','bulk_import_medicines',array['jsonb','text','uuid'],'bulk medicine import RPC exists');
select has_trigger('public','patients','audit_patient_created','patient creation is audited at the database boundary');
select has_trigger('public','patient_reports','audit_patient_report','report upload metadata is audited at the database boundary');
select col_has_check('public','patient_reports','size_bytes','patient report metadata enforces the 1 MB limit');
select has_table('public','stock_movements','stock movement ledger exists');
select has_table('public','inventory_stock_movements','consumable stock movement ledger exists');
select has_function('public','save_medicine_batch',array['uuid','uuid','text','date','integer','bigint','bigint','integer','boolean','text','uuid','integer'],'atomic stock adjustment workflow exists');
select has_function('public','save_inventory_item',array['uuid','text','text','bigint','integer','integer','date','boolean','text','uuid'],'guarded consumable stock adjustment workflow exists');
select isnt_empty($$select policyname from pg_policies where schemaname='public' and tablename='inventory_stock_movements'$$,'consumable stock ledger has RLS policies');
select has_function('public','review_patient_report',array['uuid'],'controlled doctor report review exists');
select has_trigger('public','patient_reports','validate_report_relationship','report links are validated at the database boundary');
select has_function('public','report_admin_overview',array['date','date'],'server-side admin analytics exists');
select has_function('public','search_medicine_availability',array['text','integer'],'doctor-safe medicine availability RPC exists');
select hasnt_function('public','list_pharmacy_batches',array['integer','integer'],'legacy unfiltered pharmacy batch listing is removed');
select has_function('public','list_pharmacy_batches',array['text','integer','integer'],'searchable guarded pharmacy batch listing exists');
select has_function('public','list_medicine_directory',array['text','integer','integer','boolean'],'guarded medicine directory listing exists');
select has_column('public','medicine_directory','archived_at','removed medicines are archived rather than erased');
select has_column('public','medicine_directory','archived_by','medicine removal records who removed it');
select has_function('public','delete_medicine',array['uuid'],'history-safe medicine removal RPC exists');
select has_function('public','restore_medicine',array['uuid'],'archived medicine can be returned to the library');
select has_function('public','list_available_dispense_batches',array['integer'],'guarded FEFO dispensing batch list exists');
select has_function('public','list_dispense_batches_for_medicines',array['uuid[]'],'scoped live multi-batch dispense list exists');
select ok(
  pg_get_functiondef('public.list_pharmacy_sales(text,integer,integer)'::regprocedure)
    not like '%public.ip_inventory_requests%',
  'pharmacy sales ledger no longer references removed IP requests'
);
select has_function('public','operational_data_signature',array[]::text[],'cost-controlled live data signature exists');
select has_function('public','get_visit_financial_summaries',array['uuid[]'],'guarded visit finance RPC exists');
select has_function('public','get_editable_consultation_fee',array['uuid'],'clinical fee-only read RPC exists');
select has_function('public','search_diagnosis_terms',array['text','text','integer'],'code-system-filtered diagnosis search exists');
select has_table('public','snomed_releases','official SNOMED release metadata exists');
select has_table('public','snomed_concepts','official SNOMED current terminology exists');
select ok(
  pg_get_functiondef('public.search_diagnosis_terms(text,text,integer)'::regprocedure)
    like '%public.snomed_concepts%',
  'diagnosis search includes official SNOMED concepts'
);
select isnt_empty($$select policyname from pg_policies where schemaname='public' and tablename='snomed_concepts'$$,'official SNOMED concepts are protected by RLS');
select is(has_table_privilege('anon','public.snomed_concepts','SELECT'),false,'anonymous users have no raw SNOMED table grant');
select is(has_table_privilege('authenticated','public.snomed_concepts','INSERT'),false,'authenticated users cannot write official SNOMED terminology');
select has_table('public','clinical_term_catalog_memberships','clinical catalog provenance is retained');
select is((select count(*) from public.clinical_term_catalog_memberships where catalog='SNOMED-ready common diagnosis dataset'),727::bigint,'all supplied SNOMED-ready diagnoses are seeded');
select is((select count(*) from public.clinical_terms term join public.clinical_term_catalog_memberships membership on membership.term_id=term.id where membership.catalog='SNOMED-ready common diagnosis dataset' and term.normalized_text='fever'),1::bigint,'seeded Fever diagnosis is searchable locally');
select is(
  (
    select count(*)
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    join pg_namespace enum_namespace on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'public'
      and enum_type.typname = 'app_role'
      and enum_value.enumlabel = 'op'
  ),
  1::bigint,
  'OP role is available for the separate vitals desk'
);
select has_trigger('public','vitals','protect_closed_visit_vitals','closed visit vitals are immutable');
select has_trigger('public','prescriptions','protect_prescription_status','prescription lifecycle is protected');
select has_trigger('public','prescriptions','set_prescription_issued_at','pharmacy expiry starts when the doctor issues the prescription');
select has_column('public','prescriptions','prescription_number','prescriptions have a printable lookup number');
select col_is_unique('public','prescriptions','prescription_number','prescription lookup numbers are unique');
select col_is_pk('public','patients','id','patient internal identity is UUID primary key');
select col_has_check('public','medicine_batches','quantity','stock has a non-negative check');
select isnt_empty($$select policyname from pg_policies where schemaname='public' and tablename='patients'$$,'patients have RLS policies');
select isnt_empty($$select policyname from pg_policies where schemaname='public' and tablename='notification_reads'$$,'notification reads have RLS policies');
select is(has_table_privilege('authenticated','public.leads','INSERT'),false,'staff cannot bypass lead RPCs');
select is(has_table_privilege('authenticated','public.meta_integration_secrets','SELECT'),false,'Meta secrets are not exposed to staff sessions');
select is(has_function_privilege('anon','public.ingest_meta_lead(jsonb)','EXECUTE'),false,'anonymous users cannot ingest leads directly');
select is(has_function_privilege('authenticated','public.ingest_meta_lead(jsonb)','EXECUTE'),false,'staff sessions cannot impersonate Meta ingestion');
select * from finish();
rollback;
