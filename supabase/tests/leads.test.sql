begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('26000000-0000-0000-0000-000000000001','lead-admin@example.invalid','{"role":"admin"}','{"full_name":"Lead admin"}'),
('26000000-0000-0000-0000-000000000002','lead-sales-a@example.invalid','{"role":"sales_executive"}','{"full_name":"Sales A"}'),
('26000000-0000-0000-0000-000000000003','lead-sales-b@example.invalid','{"role":"sales_executive"}','{"full_name":"Sales B"}'),
('26000000-0000-0000-0000-000000000004','lead-untrusted@example.invalid','{}','{"full_name":"Untrusted","role":"admin"}');
select is((select status::text from public.profiles where id='26000000-0000-0000-0000-000000000004'),'inactive','user metadata cannot grant an active admin role');
create temp table lead_test_ids(label text primary key,id uuid);
grant all on lead_test_ids to authenticated;
select set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into lead_test_ids values ('mine',public.create_manual_lead('CRM Test Enquiry','9876543210',p_idempotency_key=>'26000000-0000-0000-0000-000000000010'));
select is((select assigned_to from public.leads where id=(select id from lead_test_ids where label='mine')),'26000000-0000-0000-0000-000000000002'::uuid,'sales executive enquiries assign to themselves');
select is(public.create_manual_lead('CRM Test Enquiry','9876543210',p_idempotency_key=>'26000000-0000-0000-0000-000000000010'),(select id from lead_test_ids where label='mine'),'manual submission retry returns the same lead');
select throws_ok($$select public.create_manual_lead('Different Enquiry','9876543210',p_idempotency_key=>'26000000-0000-0000-0000-000000000010')$$,'22023','This form was already submitted with different details.','changed payload cannot reuse a submission key');
select throws_ok($$select public.assign_lead((select id from lead_test_ids where label='mine'),'26000000-0000-0000-0000-000000000003')$$,'42501','forbidden','sales cannot reassign leads');
select lives_ok($$select public.add_lead_note((select id from lead_test_ids where label='mine'),'call','Interested in appointment',now()+interval '1 day',false)$$,'sales can log a call and follow-up');
select is((select status from public.leads where id=(select id from lead_test_ids where label='mine')),'contacted','first call moves a new lead to contacted');
select throws_ok($$select public.update_lead_status((select id from lead_test_ids where label='mine'),'lost')$$,'22023','Give a reason for marking the lead lost.','lost status requires a reason');
insert into lead_test_ids values ('patient',public.convert_lead((select id from lead_test_ids where label='mine'),current_date+interval '2 days 10 hours',null,'CRM Test Patient','female'));
select is((select count(*) from public.patients),0::bigint,'sales cannot read the clinical patient directory');
select is((select count(*) from public.find_lead_patient_matches((select id from lead_test_ids where label='mine'))),1::bigint,'booking offers an identity-only patient match');
select lives_ok($$select public.convert_lead((select id from lead_test_ids where label='mine'),current_date+interval '2 days 10 hours',null,'CRM Test Patient','female')$$,'booking retry succeeds');
select is((select count(*) from public.lead_activities where lead_id=(select id from lead_test_ids where label='mine') and to_status='booked'),1::bigint,'booking retry does not duplicate timeline activity');
reset role;
select set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.leads where id=(select id from lead_test_ids where label='mine')),0::bigint,'another salesperson cannot read this lead');
select is((select count(*) from public.lead_activities where lead_id=(select id from lead_test_ids where label='mine')),0::bigint,'another salesperson cannot read its timeline');
select throws_ok($$select public.add_lead_note((select id from lead_test_ids where label='mine'),'note','Not mine')$$,'42501','forbidden','another salesperson cannot write a note');
select throws_ok($$select public.create_manual_lead('CRM Test Enquiry','9876543210',p_idempotency_key=>'26000000-0000-0000-0000-000000000010')$$,'42501','forbidden','replay keys cannot disclose another salesperson lead');
select throws_ok($$select public.convert_lead((select id from lead_test_ids where label='mine'),now()+interval '3 days')$$,'42501','forbidden','another salesperson cannot book the lead');
select throws_ok($$select * from public.list_lead_appointments(current_date)$$,'42501','forbidden','sales cannot enumerate reception appointments');
select throws_ok($$select * from public.meta_integration_secrets$$,'42501',null,'sales cannot retrieve Meta credentials');
reset role;
select set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.assign_lead((select id from lead_test_ids where label='mine'),'26000000-0000-0000-0000-000000000003')$$,'admin can reassign a lead');
reset role;
select set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.add_lead_note((select id from lead_test_ids where label='mine'),'note','Stale form')$$,'42501','forbidden','previous owner loses write access immediately');
reset role;
-- A real visit triggers conversion without reopening or replacing old history.
insert into public.departments(id,name) values('26000000-0000-0000-0000-000000000020','CRM test department');
insert into public.doctors(id,display_name,department_id) values('26000000-0000-0000-0000-000000000021','CRM Doctor','26000000-0000-0000-0000-000000000020');
insert into public.visits(id,patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,idempotency_key)
select '26000000-0000-0000-0000-000000000022',id,'26000000-0000-0000-0000-000000000021','26000000-0000-0000-0000-000000000020','op',current_date+2,26001,0,'waiting','26000000-0000-0000-0000-000000000023'
from lead_test_ids where label='patient';
select is((select status from public.leads where id=(select id from lead_test_ids where label='mine')),'converted','a reception visit converts the booking');
select is((select converted_visit_id from public.leads where id=(select id from lead_test_ids where label='mine')),'26000000-0000-0000-0000-000000000022'::uuid,'conversion links the exact visit');
select set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.update_lead_status((select id from lead_test_ids where label='mine'),'interested')$$,'22023','A converted lead is closed.','converted leads cannot be reopened by pipeline edits');
select throws_ok($$select public.add_lead_note((select id from lead_test_ids where label='mine'),'note','Schedule again',now()+interval '1 day')$$,'22023','A converted lead is closed.','closed enquiries cannot acquire a follow-up through the RPC');
reset role;
insert into public.leads(full_name,phone_raw,patient_id,status,appointment_at)
select 'Future enquiry','9876543210',id,'booked',current_date+interval '5 days 10 hours' from lead_test_ids where label='patient';
insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,idempotency_key,created_at)
select id,'26000000-0000-0000-0000-000000000021','26000000-0000-0000-0000-000000000020','op',current_date+3,26002,0,'waiting','26000000-0000-0000-0000-000000000024',now()+interval '1 second' from lead_test_ids where label='patient';
select is((select status from public.leads where full_name='Future enquiry' and patient_id=(select id from lead_test_ids where label='patient')),'booked','an unrelated visit does not consume a future appointment');
select * from finish();
rollback;
