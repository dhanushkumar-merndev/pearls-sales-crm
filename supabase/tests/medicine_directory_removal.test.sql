-- Removing a medicine from the library must never rewrite what the hospital
-- already did. These checks pin both halves of that contract: an untouched
-- medicine is really deleted, and one that history depends on is archived with
-- every prescription, sale and stock ledger row left byte-for-byte intact.
begin;
select plan(31);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('31000000-0000-0000-0000-000000000099','medicine-fixture@example.invalid','{"role":"admin"}','{"full_name":"Medicine fixture"}');
create temp table test_actor as
select id from public.profiles where id = '31000000-0000-0000-0000-000000000099';
grant select on test_actor to authenticated;
select ok(exists(select 1 from test_actor), 'configured admin fixture actor exists');
select set_config('request.jwt.claim.sub', (select id::text from test_actor), true);
update public.profiles set role = 'admin', doctor_id = null
where id = (select id from test_actor);

insert into public.departments(id, name)
values ('31000000-0000-0000-0000-000000000001', 'Medicine removal test');
insert into public.doctors(
  id, display_name, department_id, registration_number,
  op_fee_paise, follow_up_fee_paise
) values (
  '31000000-0000-0000-0000-000000000002', 'Dr Removal Test',
  '31000000-0000-0000-0000-000000000001', 'REMOVAL-TEST-20260920', 0, 0
);
insert into public.patients(id, phone_normalized, name, created_by)
values ('31000000-0000-0000-0000-000000000003', '9876500031', 'Medicine Removal Test', (select id from test_actor));
insert into public.visits(
  id, patient_id, doctor_id, department_id, visit_type, visit_date,
  token_number, fee_paise, status, idempotency_key, created_by
) values (
  '31000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001',
  'op', current_date, 31001, 0, 'completed',
  '31000000-0000-0000-0000-000000000005', (select id from test_actor)
);

-- Three medicines: one with history behind it, one never used at all, and one
-- that only ever held stock.
insert into public.medicine_directory(
  id, brand_name, generic_name, strength, dosage_form, source
) values
  ('31000000-0000-0000-0000-000000000006', 'Removal History Tablet', 'Test medicine', '10 mg', 'Tablet', 'automated-test'),
  ('31000000-0000-0000-0000-000000000007', 'Removal Unused Tablet', 'Test medicine', '20 mg', 'Tablet', 'automated-test'),
  ('31000000-0000-0000-0000-000000000008', 'Removal Stocked Tablet', 'Test medicine', '30 mg', 'Tablet', 'automated-test');
insert into public.medicine_batches(
  id, medicine_id, batch_number, expiry_date, quantity,
  selling_price_paise, units_per_pack, low_stock_threshold
) values
  ('31000000-0000-0000-0000-000000000009', '31000000-0000-0000-0000-000000000006', 'REMOVAL-HISTORY', current_date + 365, 100, 3000, 10, 5),
  ('31000000-0000-0000-0000-000000000010', '31000000-0000-0000-0000-000000000008', 'REMOVAL-STOCK', current_date + 365, 40, 2000, 10, 5);
insert into public.prescriptions(id, visit_id, doctor_id, status)
values ('31000000-0000-0000-0000-000000000011', '31000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000002', 'draft');
insert into public.prescription_items(
  id, prescription_id, medicine_id, medicine_name, requested_quantity
) values (
  '31000000-0000-0000-0000-000000000012', '31000000-0000-0000-0000-000000000011',
  '31000000-0000-0000-0000-000000000006', 'Removal History Tablet', 10
);
update public.prescriptions set status = 'pending'
where id = '31000000-0000-0000-0000-000000000011';

-- Browser roles have no direct SELECT grant on medicine_batches, so the checks
-- below read quantities through an owner-only helper instead of weakening a
-- production grant.
create function pg_temp.test_batch_quantity(p_batch_id uuid)
returns integer language sql stable security definer set search_path = ''
as $$ select quantity from public.medicine_batches where id = p_batch_id $$;
create function pg_temp.test_batch_active(p_batch_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select active from public.medicine_batches where id = p_batch_id $$;

create temp table removal_results(kind text primary key, result jsonb);
grant select, insert on removal_results to authenticated;
set local role authenticated;

select lives_ok($$
  select public.dispense_prescription(
    '31000000-0000-0000-0000-000000000011',
    '[{"prescription_item_id":"31000000-0000-0000-0000-000000000012","batch_id":"31000000-0000-0000-0000-000000000009","quantity":10}]'::jsonb,
    'cash', '31000000-0000-0000-0000-000000000013', 0
  )
$$, 'the medicine is dispensed once so it has real history behind it');

-- A medicine nothing has ever touched leaves no reason to keep the row.
select lives_ok($$
  insert into removal_results
  values ('unused', public.delete_medicine('31000000-0000-0000-0000-000000000007'))
$$, 'an unused medicine can be removed');
select is(
  (select result ->> 'mode' from removal_results where kind = 'unused'),
  'deleted', 'an unused medicine is deleted outright rather than archived'
);
reset role;
select is(
  (select count(*) from public.medicine_directory where id = '31000000-0000-0000-0000-000000000007'),
  0::bigint, 'the deleted medicine row is really gone'
);
select is(
  (select count(*) from public.audit_logs where action = 'MEDICINE_DELETED' and entity_id = '31000000-0000-0000-0000-000000000007'),
  1::bigint, 'an outright deletion is written to the audit trail'
);
set local role authenticated;

-- A medicine history depends on keeps its row; only its visibility changes.
select lives_ok($$
  insert into removal_results
  values ('history', public.delete_medicine('31000000-0000-0000-0000-000000000006'))
$$, 'a dispensed medicine can still be removed from the library');
select is(
  (select result ->> 'mode' from removal_results where kind = 'history'),
  'archived', 'a medicine with history is archived instead of deleted'
);
reset role;
select isnt(
  (select archived_at from public.medicine_directory where id = '31000000-0000-0000-0000-000000000006'),
  null::timestamptz, 'the archived medicine records when it left the library'
);
select is(
  (select active from public.medicine_directory where id = '31000000-0000-0000-0000-000000000006'),
  false, 'the archived medicine is inactive for every autocomplete'
);
select is(
  (select archived_by from public.medicine_directory where id = '31000000-0000-0000-0000-000000000006'),
  (select id from test_actor), 'the archived medicine records who removed it'
);

-- The whole point: nothing behind it moved.
select is(
  (select medicine_id from public.prescription_items where id = '31000000-0000-0000-0000-000000000012'),
  '31000000-0000-0000-0000-000000000006'::uuid,
  'the old prescription still points at the same medicine'
);
select is(
  (select medicine_name from public.prescription_items where id = '31000000-0000-0000-0000-000000000012'),
  'Removal History Tablet', 'the old prescription keeps the name it was written with'
);
select is(
  (select dispensed_quantity from public.prescription_items where id = '31000000-0000-0000-0000-000000000012'),
  10, 'the dispensed quantity on record is unchanged'
);
select is(
  (select status::text from public.prescriptions where id = '31000000-0000-0000-0000-000000000011'),
  'dispensed', 'the old prescription keeps its outcome'
);
select is(
  (select count(*) from public.pharmacy_sale_items where batch_id = '31000000-0000-0000-0000-000000000009'),
  1::bigint, 'the sale line for the removed medicine survives'
);
select is(
  (select sum(quantity_delta) from public.stock_movements where batch_id = '31000000-0000-0000-0000-000000000009'),
  -10::bigint, 'the stock ledger for the removed medicine survives'
);
select is(
  pg_temp.test_batch_quantity('31000000-0000-0000-0000-000000000009'), 90,
  'the removed medicine keeps its counted stock exactly'
);
select is(
  pg_temp.test_batch_active('31000000-0000-0000-0000-000000000009'), false,
  'the removed medicine stops counting towards stock dashboards'
);

-- Counted stock is never silently discarded, even with no clinical history.
set local role authenticated;
select lives_ok($$
  insert into removal_results
  values ('stocked', public.delete_medicine('31000000-0000-0000-0000-000000000008'))
$$, 'a medicine that only holds stock can be removed');
select is(
  (select result ->> 'mode' from removal_results where kind = 'stocked'),
  'archived', 'stock on hand forces the archive path instead of a delete'
);
select is(
  (select (result ->> 'stock_units_held')::bigint from removal_results where kind = 'stocked'),
  40::bigint, 'the removal reports the stock it refused to discard'
);
reset role;
select is(
  pg_temp.test_batch_quantity('31000000-0000-0000-0000-000000000010'), 40,
  'the held stock is still counted after removal'
);

-- The library, and only the library, stops showing it.
set local role authenticated;
select is(
  (select count(*) from public.list_medicine_directory('Removal', 100, 0)),
  0::bigint, 'no removed medicine appears in the library listing'
);
select is(
  (select count(*) from public.list_medicine_directory('Removal', 100, 0, true)),
  2::bigint, 'both archived medicines appear in the removed listing'
);
select is(
  (select count(*) from public.search_medicine_availability('Removal History', 25)),
  0::bigint, 'a removed medicine cannot be prescribed from autocomplete'
);
select is(
  (select count(*) from public.search_medicine_availability('Removal Stocked', 25)),
  0::bigint, 'removed stock is excluded from prescribing availability'
);

-- And it can come back.
select lives_ok($$
  select public.restore_medicine('31000000-0000-0000-0000-000000000006')
$$, 'an archived medicine can be returned to the library');
select is(
  (select count(*) from public.list_medicine_directory('Removal History', 100, 0)),
  1::bigint, 'the restored medicine is listed in the library again'
);

reset role;
update public.profiles set role = 'pharmacy'
where id = (select id from test_actor);
set local role authenticated;
select throws_ok($$
  select public.delete_medicine('31000000-0000-0000-0000-000000000006')
$$, '42501', 'forbidden', 'pharmacy cannot remove a medicine from the library');
select throws_ok($$
  select public.restore_medicine('31000000-0000-0000-0000-000000000008')
$$, '42501', 'forbidden', 'pharmacy cannot restore a removed medicine');
reset role;

select * from finish();
rollback;
