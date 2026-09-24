begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('25000000-0000-0000-0000-000000000099','security-fixture@example.invalid','{"role":"admin"}','{"full_name":"Security fixture"}');
create temp table test_actor as select id from public.profiles where id='25000000-0000-0000-0000-000000000099';
grant select on test_actor to authenticated;
select ok(exists(select 1 from test_actor),'configured admin fixture exists');
select set_config('request.jwt.claim.sub',(select id::text from test_actor),true);
insert into public.patients(id, phone_normalized, name, created_by)
values (
  '25000000-0000-0000-0000-000000000001',
  '9876500099',
  'Unlinked Pharmacy Security Test',
  (select id from test_actor)
);

set local role authenticated;
select lives_ok($$select public.report_admin_overview(current_date,current_date)$$,'admin can use financial analytics');
select lives_ok($$select count(*) from public.snomed_concepts$$,'admin can inspect official SNOMED terminology');
reset role;

update public.profiles set role='reception',doctor_id=null where id=(select id from test_actor);
set local role authenticated;
select lives_ok($$select public.dashboard_summary()$$,'reception can load its dashboard');
select lives_ok($$select * from public.list_lead_appointments(current_date)$$,'reception can open booked lead appointments');
select lives_ok($$select * from public.list_medicine_directory(null,20,0)$$,'reception can list safe medicine availability');
select lives_ok($$select * from public.search_medicine_availability('par',20)$$,'reception can search safe medicine availability');
select lives_ok($$select count(*) from public.patient_reports$$,'reception can read the reports workspace');
select throws_ok(
  $$select public.record_visit_vitals('00000000-0000-0000-0000-000000000001',null,null,null,null,null,null,null,null,null)$$,
  '42501','forbidden','reception cannot record vitals'
);
select throws_ok($$select public.report_admin_overview(current_date,current_date)$$,'42501','forbidden','reception cannot use admin financial analytics');
select throws_ok($$select public.dispense_prescription('00000000-0000-0000-0000-000000000001','[]'::jsonb,'cash','00000000-0000-0000-0000-000000000002')$$,'42501','forbidden','reception cannot dispense prescriptions');
select throws_ok($$select * from public.list_dispense_batches_for_medicines(array['00000000-0000-0000-0000-000000000001'::uuid])$$,'42501','forbidden','reception cannot inspect pharmacy batch detail');
reset role;

update public.profiles set role='op',doctor_id=null where id=(select id from test_actor);
set local role authenticated;
select lives_ok($$select public.dashboard_summary()$$,'OP staff can load their dashboard');
select is((public.dashboard_summary() ? 'collected_today_paise'),false,'OP dashboard has no collections');
select throws_ok($$select public.record_visit_vitals('00000000-0000-0000-0000-000000000001',null,null,null,null,null,null,null,null,null)$$,'42501','visit unavailable','OP reaches the visit guard');
select is((select count(*) from public.visit_payments),0::bigint,'OP staff cannot see visit payments');
reset role;

update public.profiles set role='doctor',doctor_id=null where id=(select id from test_actor);
set local role authenticated;
select throws_ok($$select public.report_admin_overview(current_date,current_date)$$,'42501','forbidden','doctor cannot use admin analytics');
select is((public.dashboard_summary() ? 'collected_today_paise'),false,'doctor dashboard payload contains no hospital collection key');
select throws_ok($$select purchase_price_paise from public.medicine_batches limit 1$$,'42501',null,'doctor cannot query pharmacy cost columns');
select lives_ok($$select * from public.search_medicine_availability('par',20)$$,'doctor can query safe medicine availability');
select lives_ok($$select * from public.search_diagnosis_terms('fever','SNOMED-CT',20)$$,'doctor can search the guarded SNOMED directory');
select is((select count(*) from public.snomed_concepts),0::bigint,'doctor cannot enumerate the raw SNOMED terminology table');
select throws_ok($$select public.dispense_prescription('00000000-0000-0000-0000-000000000001','[]'::jsonb,'cash','00000000-0000-0000-0000-000000000002')$$,'42501','forbidden','doctor cannot dispense prescriptions');
select throws_ok($$select public.expire_stale_prescriptions()$$,'42501','forbidden','doctor cannot run pharmacy expiry maintenance');
select lives_ok($$insert into public.notification_reads(user_id,notification_key) values(auth.uid(),'security-own-notification')$$,'users can persist their own notification read state');
select throws_ok($$insert into public.notification_reads(user_id,notification_key) values(gen_random_uuid(),'security-other-notification')$$,'42501',null,'users cannot write another notification read state');
select is((select count(*) from public.visit_payments),0::bigint,'doctor cannot read financial payment rows');
select throws_ok($$select fee_paise from public.visits limit 1$$,'42501',null,'doctor cannot query visit fee columns');
select throws_ok($$select * from public.get_visit_financial_summaries(array[]::uuid[])$$,'42501','forbidden','doctor cannot call guarded visit finance RPC');
reset role;

update public.profiles set role='pharmacy' where id=(select id from test_actor);
set local role authenticated;
select lives_ok($$select * from public.list_dispense_batches_for_medicines(array['00000000-0000-0000-0000-000000000001'::uuid])$$,'pharmacy can load scoped live batch detail');
select is(
  (select count(*) from public.patients where id='25000000-0000-0000-0000-000000000001'),
  0::bigint,
  'pharmacy cannot read a patient unrelated to its dispensing work'
);
select throws_ok($$insert into public.departments(name) values('Unauthorized')$$,'42501',null,'pharmacy cannot manage departments');
select lives_ok($$select * from public.search_diagnosis_terms('fever','SNOMED-CT',20)$$,'pharmacy can search diagnoses while transcribing a consultation');
select lives_ok($$select public.add_clinical_term('diagnosis','Locally entered test diagnosis')$$,'pharmacy transcription can remember a typed local diagnosis');
reset role;

update public.profiles set status='inactive' where id=(select id from test_actor);
set local role authenticated;
select throws_ok($$select public.report_admin_overview(current_date,current_date)$$,'42501','forbidden','inactive sessions cannot bypass admin role checks with NULL');
select throws_ok($$select * from public.list_pending_prescriptions(null,25,'pending',0)$$,'42501','forbidden','inactive sessions cannot read the pharmacy queue');
select throws_ok($$select * from public.list_procedure_sales(null,25,0)$$,'42501','forbidden','inactive sessions cannot read sales');
select throws_ok($$select public.record_visit_vitals('00000000-0000-0000-0000-000000000001',null,null,null,null,null,null,null,null,null)$$,'42501','forbidden','inactive sessions cannot write vitals');
reset role;

select * from finish();
rollback;
