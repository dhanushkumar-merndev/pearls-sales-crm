begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('27000000-0000-0000-0000-000000000001','meta-admin@example.invalid','{"role":"admin"}','{"full_name":"Meta admin"}'),
('27000000-0000-0000-0000-000000000002','meta-sales@example.invalid','{"role":"sales_executive"}','{"full_name":"Meta sales"}');
select set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.save_meta_credentials('27000000-0000-0000-0000-000000000001','123','encrypted-secret','encrypted-verify')$$,'42501',null,'even admin browser sessions cannot write integration secrets');
select throws_ok($$select * from public.meta_page_secrets$$,'42501',null,'admin browser sessions cannot read page tokens');
select throws_ok($$select * from public.ingest_meta_lead('{}')$$,'42501',null,'admin browser sessions cannot bypass authenticated webhook ingestion');
reset role;
set local role service_role;
select throws_ok($$select public.save_meta_credentials('27000000-0000-0000-0000-000000000002','123','encrypted-secret','encrypted-verify')$$,'42501','forbidden','configuration RPC rechecks the initiating admin');
select lives_ok($$select public.save_meta_credentials('27000000-0000-0000-0000-000000000001','123','encrypted-secret','encrypted-verify')$$,'server saves encrypted app credentials');
select lives_ok($$select public.save_meta_page('27000000-0000-0000-0000-000000000001','271234','QA Page','encrypted-page-token')$$,'server saves page subscription and secret together');
insert into public.meta_lead_forms(form_id,page_id,name,assignment_mode,assign_to,active)
values('275678','271234','QA Form','specific','27000000-0000-0000-0000-000000000002',true);
select is((select created from public.ingest_meta_lead('{"leadgen_id":"279001","form_id":"275678","page_id":"271234","full_name":"Meta QA Lead","phone_raw":"+91 9876543210","phone_normalized":"9876543210","platform":"ig"}')),true,'first Meta delivery creates a lead');
select is((select assigned_to from public.leads where meta_leadgen_id='279001'),'27000000-0000-0000-0000-000000000002'::uuid,'specific form assignment is honored');
select is((select platform from public.leads where meta_leadgen_id='279001'),'instagram','Meta platform is normalized');
select is((select created from public.ingest_meta_lead('{"leadgen_id":"279001","form_id":"275678","page_id":"271234","full_name":"Meta QA Lead"}')),false,'duplicate delivery is acknowledged without a second lead');
select is((select count(*) from public.leads where meta_leadgen_id='279001'),1::bigint,'retry produces exactly one record');
select throws_ok($$select * from public.ingest_meta_lead('{"leadgen_id":"279002","form_id":"275678","page_id":"999999","full_name":"Wrong page"}')$$,'22023','Lead form is not configured or active.','form cannot be ingested through another page');
update public.meta_lead_forms set active=false where form_id='275678';
select throws_ok($$select * from public.ingest_meta_lead('{"leadgen_id":"279003","form_id":"275678","page_id":"271234","full_name":"Disabled"}')$$,'22023','Lead form is not configured or active.','disabled forms cannot create enquiries');
update public.meta_lead_forms set active=true where form_id='275678';
select lives_ok($$select public.save_meta_credentials('27000000-0000-0000-0000-000000000001','456','new-encrypted-secret','new-encrypted-verify')$$,'changing the app succeeds atomically');
select is((select active from public.meta_lead_forms where form_id='275678'),false,'changing app disables old forms');
select is((select subscribed from public.meta_pages where page_id='271234'),false,'changing app disconnects old pages');
select is((select count(*) from public.meta_page_secrets where page_id='271234'),0::bigint,'changing app removes tokens for the previous app');
reset role;
select * from finish();
rollback;
