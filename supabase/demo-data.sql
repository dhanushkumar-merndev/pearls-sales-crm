\set ON_ERROR_STOP on

-- Meenakshi HMS realistic demo dataset.
-- Safe to run again: generated rows use stable natural keys or deterministic UUIDs.
-- This file is deliberately separate from migrations so production deployments are
-- never populated with demo clinical data automatically.

begin;
set local timezone = 'Asia/Kolkata';
set local statement_timeout = '10min';

do $$
begin
  if not exists (
    select 1 from public.profiles
    where email = 'admin@meenakshihospital.com' and role = 'admin'
  ) then
    raise exception 'The Meenakshi admin profile must exist before demo seeding';
  end if;
end $$;

insert into public.departments(name, description, active)
values
  ('General Medicine', 'General outpatient and inpatient medicine', true),
  ('Paediatrics', 'Child and adolescent healthcare', true),
  ('Orthopaedics', 'Bone, joint, and trauma care', true),
  ('Obstetrics & Gynaecology', 'Women’s health and maternity care', true),
  ('Cardiology', 'Heart and cardiovascular care', true),
  ('Dermatology', 'Skin, hair, and nail care', true),
  ('ENT', 'Ear, nose, and throat care', true),
  ('Ophthalmology', 'Eye care and vision services', true),
  ('Neurology', 'Brain and nervous system care', true),
  ('Pulmonology', 'Respiratory and lung care', true),
  ('Gastroenterology', 'Digestive system care', true),
  ('General Surgery', 'General surgical services', true)
on conflict (name) do update
set description = excluded.description, active = true;

with department_seed as (
  select * from (values
    (1, 'Dr. Arjun Raman', 'General Medicine', 'Internal Medicine', 'MBBS, MD', 60000, 40000, 70000),
    (2, 'Dr. Priya Narayanan', 'General Medicine', 'Diabetology', 'MBBS, MD', 65000, 45000, 75000),
    (3, 'Dr. Karthik Selvan', 'Paediatrics', 'Paediatrics', 'MBBS, DCH', 55000, 35000, 65000),
    (4, 'Dr. Meera Krishnan', 'Paediatrics', 'Neonatology', 'MBBS, MD', 70000, 45000, 80000),
    (5, 'Dr. Vivek Anand', 'Orthopaedics', 'Joint Replacement', 'MBBS, MS Ortho', 75000, 50000, 90000),
    (6, 'Dr. Nithya Rajan', 'Orthopaedics', 'Sports Medicine', 'MBBS, DNB Ortho', 70000, 45000, 85000),
    (7, 'Dr. Lakshmi Suresh', 'Obstetrics & Gynaecology', 'Obstetrics', 'MBBS, MS OBG', 75000, 50000, 90000),
    (8, 'Dr. Divya Mohan', 'Obstetrics & Gynaecology', 'Gynaecology', 'MBBS, DGO', 70000, 45000, 85000),
    (9, 'Dr. Raghav Menon', 'Cardiology', 'Clinical Cardiology', 'MBBS, MD, DM', 100000, 70000, 120000),
    (10, 'Dr. Ananya Iyer', 'Cardiology', 'Preventive Cardiology', 'MBBS, MD, DNB', 90000, 60000, 110000),
    (11, 'Dr. Sanjay Kumar', 'Dermatology', 'Clinical Dermatology', 'MBBS, MD DVL', 65000, 40000, 70000),
    (12, 'Dr. Kavya Prasad', 'Dermatology', 'Dermatology', 'MBBS, DDVL', 60000, 40000, 70000),
    (13, 'Dr. Hari Shankar', 'ENT', 'Otology', 'MBBS, MS ENT', 65000, 40000, 75000),
    (14, 'Dr. Swetha Balan', 'ENT', 'Rhinology', 'MBBS, DLO', 60000, 40000, 70000),
    (15, 'Dr. Akhil Varma', 'Ophthalmology', 'Cataract & Cornea', 'MBBS, MS Ophthal', 70000, 45000, 80000),
    (16, 'Dr. Rekha Nair', 'Ophthalmology', 'General Ophthalmology', 'MBBS, DO', 60000, 40000, 70000),
    (17, 'Dr. Sriram Iyer', 'Neurology', 'Clinical Neurology', 'MBBS, MD, DM', 100000, 70000, 120000),
    (18, 'Dr. Pooja Menon', 'Neurology', 'Headache Medicine', 'MBBS, DNB Neuro', 90000, 60000, 110000),
    (19, 'Dr. Ajay Thomas', 'Pulmonology', 'Respiratory Medicine', 'MBBS, MD Chest', 75000, 50000, 90000),
    (20, 'Dr. Shruthi Rao', 'Pulmonology', 'Asthma & Allergy', 'MBBS, DNB', 70000, 45000, 85000),
    (21, 'Dr. Naveen George', 'Gastroenterology', 'Clinical Gastroenterology', 'MBBS, MD, DM', 95000, 65000, 115000),
    (22, 'Dr. Deepa Joseph', 'Gastroenterology', 'Hepatology', 'MBBS, DNB Gastro', 90000, 60000, 110000),
    (23, 'Dr. Arun Prakash', 'General Surgery', 'Laparoscopic Surgery', 'MBBS, MS Surgery', 80000, 55000, 100000),
    (24, 'Dr. Gayathri Devi', 'General Surgery', 'General Surgery', 'MBBS, DNB Surgery', 75000, 50000, 95000)
  ) as s(seq, display_name, department_name, specialization, qualification, op_fee, follow_fee, ip_fee)
)
insert into public.doctors(
  display_name, department_id, specialization, qualification,
  registration_number, op_fee_paise, follow_up_fee_paise,
  ip_visit_fee_paise, active
)
select
  s.display_name, d.id, s.specialization, s.qualification,
  'TNMC-DEMO-' || lpad(s.seq::text, 5, '0'), s.op_fee, s.follow_fee,
  s.ip_fee, true
from department_seed s
join public.departments d on d.name = s.department_name
on conflict (registration_number) do update
set display_name = excluded.display_name,
    department_id = excluded.department_id,
    specialization = excluded.specialization,
    qualification = excluded.qualification,
    op_fee_paise = excluded.op_fee_paise,
    follow_up_fee_paise = excluded.follow_up_fee_paise,
    ip_visit_fee_paise = excluded.ip_visit_fee_paise,
    active = true;

insert into public.report_categories(name, active)
values
  ('Lab Report', true), ('X-Ray / Radiology', true), ('Scan', true),
  ('Prescription', true), ('Clinical Photo', true),
  ('Discharge Summary', true), ('IP Document', true), ('Other', true)
on conflict (name) do update set active = true;

insert into public.charges(category, charge_name, amount_paise, active)
values
  ('OP', 'OP Consultation', 60000, true),
  ('Follow-up', 'Follow-up Consultation', 40000, true),
  ('IP Doctor', 'IP Doctor Visit', 75000, true),
  ('Ward', 'General Ward / Day', 80000, true),
  ('Room', 'Private Room / Day', 180000, true),
  ('Treatment', 'Nebulization', 30000, true),
  ('Treatment', 'Dressing', 25000, true),
  ('Test', 'Complete Blood Count', 45000, true),
  ('Test', 'Chest X-Ray', 70000, true)
on conflict (category, charge_name) do update
set amount_paise = excluded.amount_paise, active = true;

insert into public.hospital_settings(
  id, hospital_name, address, phone, email,
  prescription_footer, token_footer, digital_prescription_text
)
values (
  true, 'Meenakshi Hospital',
  'Tamil Nadu, India', '044-4000 2026', 'care@meenakshihospital.com',
  'For appointments and follow-up, contact Meenakshi Hospital.',
  'Please wait until your token is called.',
  'This prescription was generated from the Meenakshi Hospital clinical system.'
)
on conflict (id) do update
set hospital_name = excluded.hospital_name,
    address = coalesce(public.hospital_settings.address, excluded.address),
    phone = coalesce(public.hospital_settings.phone, excluded.phone),
    email = coalesce(public.hospital_settings.email, excluded.email),
    prescription_footer = coalesce(public.hospital_settings.prescription_footer, excluded.prescription_footer),
    token_footer = coalesce(public.hospital_settings.token_footer, excluded.token_footer),
    digital_prescription_text = coalesce(public.hospital_settings.digital_prescription_text, excluded.digital_prescription_text);

insert into public.clinical_terms(term_type, display_text, search_aliases, source)
values
  ('symptom', 'Fever', array['pyrexia'], 'hospital demo'),
  ('symptom', 'Cough', array['dry cough', 'productive cough'], 'hospital demo'),
  ('symptom', 'Headache', array['head pain'], 'hospital demo'),
  ('symptom', 'Sore throat', array['throat pain'], 'hospital demo'),
  ('symptom', 'Breathlessness', array['shortness of breath', 'dyspnoea'], 'hospital demo'),
  ('symptom', 'Abdominal pain', array['stomach pain'], 'hospital demo'),
  ('symptom', 'Vomiting', array['emesis'], 'hospital demo'),
  ('symptom', 'Diarrhoea', array['loose stools'], 'hospital demo'),
  ('symptom', 'Chest pain', array[]::text[], 'hospital demo'),
  ('symptom', 'Joint pain', array['arthralgia'], 'hospital demo'),
  ('diagnosis', 'Viral fever', array['viral illness'], 'hospital demo'),
  ('diagnosis', 'Upper respiratory tract infection', array['URTI'], 'hospital demo'),
  ('diagnosis', 'Acute gastroenteritis', array['AGE'], 'hospital demo'),
  ('diagnosis', 'Essential hypertension', array['high blood pressure'], 'hospital demo'),
  ('diagnosis', 'Type 2 diabetes mellitus', array['T2DM'], 'hospital demo'),
  ('diagnosis', 'Bronchial asthma', array['asthma'], 'hospital demo'),
  ('diagnosis', 'Allergic rhinitis', array[]::text[], 'hospital demo'),
  ('diagnosis', 'Tension headache', array[]::text[], 'hospital demo'),
  ('investigation', 'Complete Blood Count', array['CBC'], 'hospital demo'),
  ('investigation', 'Blood glucose', array['RBS', 'FBS', 'PPBS'], 'hospital demo'),
  ('investigation', 'Liver Function Test', array['LFT'], 'hospital demo'),
  ('investigation', 'Renal Function Test', array['RFT'], 'hospital demo'),
  ('investigation', 'Lipid Profile', array[]::text[], 'hospital demo'),
  ('investigation', 'Thyroid Profile', array['TFT'], 'hospital demo'),
  ('investigation', 'Chest X-Ray', array['CXR'], 'hospital demo'),
  ('investigation', 'ECG', array['electrocardiogram'], 'hospital demo'),
  ('advice', 'Drink adequate fluids', array['hydration'], 'hospital demo'),
  ('advice', 'Take adequate rest', array[]::text[], 'hospital demo'),
  ('advice', 'Avoid oily and spicy food', array[]::text[], 'hospital demo'),
  ('advice', 'Return if symptoms worsen', array[]::text[], 'hospital demo')
on conflict (term_type, normalized_text) do update
set search_aliases = excluded.search_aliases, active = true;

-- 10,000 deterministic demo patients. Existing hospital patients are untouched.
with admin_user as (
  select id from public.profiles
  where email = 'admin@meenakshihospital.com' and role = 'admin'
  limit 1
), patient_seed as (
  select
    i,
    (array[
      'Aarav','Aadhya','Arjun','Ananya','Kavin','Diya','Vikram','Meera','Rahul','Nila',
      'Aditya','Ishita','Rohan','Kavya','Sanjay','Lakshmi','Naveen','Priya','Karthik','Divya',
      'Vivek','Nithya','Hari','Swetha','Akhil','Rekha','Ajay','Shruthi','Arun','Gayathri'
    ])[((i - 1) % 30) + 1] || ' ' ||
    (array[
      'Kumar','Raman','Iyer','Nair','Menon','Rajan','Selvan','Krishnan','Prasad','Anand',
      'Suresh','Mohan','Balan','Varma','Rao','George','Joseph','Thomas','Devi','Shankar',
      'Narayanan','Subramanian','Gopal','Reddy','Pillai','Srinivasan','Murali','Venkat','Das','Paul'
    ])[(((i - 1) / 30) % 30) + 1] as patient_name
  from generate_series(1, 10000) i
)
insert into public.patients(
  phone_normalized, name, dob, gender, address, blood_group,
  allergies, notes, status, created_by, created_at
)
select
  (7000000000::bigint + s.i)::text,
  s.patient_name,
  current_date - (interval '1 year' * (1 + (s.i % 82))) - (interval '1 day' * (s.i % 330)),
  (case when s.i % 3 = 0 then 'female' when s.i % 3 = 1 then 'male' else 'other' end)::public.gender,
  (array['Chennai','Coimbatore','Madurai','Salem','Tiruchirappalli','Erode','Vellore','Thanjavur'])[((s.i - 1) % 8) + 1] || ', Tamil Nadu',
  (array['O+','A+','B+','AB+','O-','A-','B-','AB-'])[((s.i - 1) % 8) + 1],
  case when s.i % 31 = 0 then 'Penicillin' when s.i % 47 = 0 then 'NSAIDs' else null end,
  'Demo patient record',
  (case when s.i % 97 = 0 then 'archived' else 'active' end)::public.patient_status,
  a.id,
  ((current_date - (s.i % 365))::timestamp + interval '8 hours' + make_interval(mins => s.i % 600)) at time zone 'Asia/Kolkata'
from patient_seed s cross join admin_user a
-- UHID, not phone, has been the unique patient identity since
-- 20260815190000_uhid_patient_identity.sql dropped patients_phone_normalized_key
-- (a household legitimately shares one number), so there is no arbiter index for
-- ON CONFLICT (phone_normalized). This guard keeps the re-run safety that clause
-- was there to provide.
where not exists (
  select 1 from public.patients p
  where p.phone_normalized = (7000000000::bigint + s.i)::text
);

-- A broad medicine directory with two batches per item.
with medicine_seed as (
  select
    i,
    (array[
      'Paracetamol','Ibuprofen','Amoxicillin','Azithromycin','Cefixime','Cetirizine',
      'Levocetirizine','Pantoprazole','Omeprazole','Metformin','Glimepiride','Amlodipine',
      'Telmisartan','Atorvastatin','Montelukast','Salbutamol','Ondansetron','Dicyclomine',
      'Diclofenac','Aceclofenac','Doxycycline','Clarithromycin','Clopidogrel','Losartan',
      'Hydrochlorothiazide','Prednisolone','Fluconazole','Albendazole','Domperidone','ORS'
    ])[((i - 1) % 30) + 1] as generic_name,
    (array['100 mg','200 mg','250 mg','400 mg','500 mg','650 mg','5 mg','10 mg','20 mg','40 mg'])[((i - 1) % 10) + 1] as strength,
    (array['Tablet','Capsule','Syrup','Suspension','Cream'])[((i - 1) % 5) + 1] as dosage_form,
    (array['Meena Pharma','Cauvery Labs','Southern Health','Lotus Remedies','GreenLeaf Pharma'])[((i - 1) % 5) + 1] as manufacturer
  from generate_series(1, 300) i
)
insert into public.medicine_directory(
  brand_name, generic_name, strength, dosage_form, manufacturer,
  active, source, source_license
)
select
  generic_name || ' ' || strength || ' ' || lpad(i::text, 3, '0'),
  generic_name, strength, dosage_form, manufacturer,
  true, 'demo_seed_v1', 'Hospital-created demonstration data'
from medicine_seed
on conflict (brand_name, generic_name, strength, dosage_form) do update
set manufacturer = excluded.manufacturer, active = true;

with medicines as (
  select id, row_number() over(order by brand_name, id) rn
  from public.medicine_directory where source = 'demo_seed_v1'
), batch_seed as (
  select m.id medicine_id, m.rn, b.batch_seq
  from medicines m cross join generate_series(1, 2) b(batch_seq)
)
insert into public.medicine_batches(
  id, medicine_id, batch_number, expiry_date, quantity,
  purchase_price_paise, selling_price_paise, low_stock_threshold, active
)
select
  md5('meenakshi-demo-batch-' || medicine_id || '-' || batch_seq)::uuid,
  medicine_id,
  'DEMO-' || lpad(rn::text, 4, '0') || '-' || batch_seq,
  current_date + make_interval(months => (4 + ((rn + batch_seq) % 30))::integer),
  case when rn % 29 = 0 and batch_seq = 1 then 0
       when rn % 17 = 0 and batch_seq = 1 then 6
       else 80 + ((rn * 13 + batch_seq * 17) % 420) end,
  100 + ((rn * 23) % 8000),
  200 + ((rn * 31) % 12000),
  10 + (rn % 20), true
from batch_seed
on conflict (medicine_id, batch_number) do update
set expiry_date = excluded.expiry_date,
    purchase_price_paise = excluded.purchase_price_paise,
    selling_price_paise = excluded.selling_price_paise,
    low_stock_threshold = excluded.low_stock_threshold,
    active = true;

with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
)
insert into public.stock_movements(
  id, batch_id, quantity_delta, reason, idempotency_key, created_by, created_at
)
select
  md5('meenakshi-demo-stock-row-' || b.id)::uuid,
  b.id, b.quantity, 'Demo opening stock',
  md5('meenakshi-demo-stock-key-' || b.id)::uuid,
  a.id, now() - interval '180 days'
from public.medicine_batches b cross join admin_user a
join public.medicine_directory m on m.id = b.medicine_id and m.source = 'demo_seed_v1'
where b.quantity <> 0
on conflict (idempotency_key) do nothing;

-- 15,000 OP visits distributed over 180 days.
with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), patients as (
  select id, row_number() over(order by phone_normalized) rn
  from public.patients where phone_normalized between '7000000001' and '7000010000'
), doctors as (
  select id, department_id, op_fee_paise,
         row_number() over(order by registration_number) rn
  from public.doctors where registration_number like 'TNMC-DEMO-%'
), source as (
  select i, ((i - 1) % 10000) + 1 patient_rn,
         ((i - 1) % 24) + 1 doctor_rn, i % 180 day_offset
  from generate_series(1, 15000) i
), numbered as (
  select *, row_number() over(partition by doctor_rn, day_offset order by i) token
  from source
)
insert into public.visits(
  id, patient_id, doctor_id, department_id, visit_type, visit_date,
  token_number, fee_paise, status, notes, idempotency_key,
  created_by, created_at
)
select
  md5('meenakshi-demo-op-' || n.i)::uuid,
  p.id, d.id, d.department_id, 'op', current_date - n.day_offset,
  n.token, d.op_fee_paise, 'ready', 'Demo OP visit',
  md5('meenakshi-demo-op-key-' || n.i)::uuid,
  a.id,
  ((current_date - n.day_offset)::timestamp + interval '8 hours' + make_interval(mins => n.i % 600)) at time zone 'Asia/Kolkata'
from numbered n
join patients p on p.rn = n.patient_rn
join doctors d on d.rn = n.doctor_rn
cross join admin_user a
on conflict (id) do nothing;

with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
)
insert into public.visit_payments(
  id, visit_id, amount_paise, mode, reference, notes,
  idempotency_key, collected_by, created_at
)
select
  md5('meenakshi-demo-payment-' || v.id)::uuid,
  v.id,
  case when right(v.id::text, 1) in ('0','1','2') then greatest(10000, v.fee_paise / 2) else v.fee_paise end,
  (case (abs(hashtext(v.id::text)) % 4) when 0 then 'cash' when 1 then 'upi' when 2 then 'card' else 'bank_transfer' end)::public.payment_mode,
  'DEMO-' || left(v.id::text, 8), 'Demo offline collection',
  md5('meenakshi-demo-payment-key-' || v.id)::uuid,
  a.id, v.created_at + interval '15 minutes'
from public.visits v cross join admin_user a
where v.id in (select md5('meenakshi-demo-op-' || i)::uuid from generate_series(1, 15000) i)
  and abs(hashtext(v.id::text)) % 10 <> 0
  and v.fee_paise > 0
on conflict (idempotency_key) do nothing;

with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
)
insert into public.vitals(
  id, visit_id, weight_kg, height_cm, temperature_f,
  bp_systolic, bp_diastolic, pulse, spo2, respiratory_rate,
  notes, recorded_by, recorded_at
)
select
  md5('meenakshi-demo-vitals-' || i)::uuid,
  v.id, 45 + (i % 45), 145 + (i % 40), 97.5 + ((i % 15)::numeric / 5),
  105 + (i % 35), 65 + (i % 25), 68 + (i % 35), 94 + (i % 7),
  14 + (i % 8), 'Demo vitals', a.id, v.created_at + interval '25 minutes'
from generate_series(1, 11000) i
join public.visits v on v.id = md5('meenakshi-demo-op-' || i)::uuid
cross join admin_user a
on conflict (visit_id) do nothing;

insert into public.consultations(
  id, visit_id, doctor_id, symptoms, history, examination,
  assessment, advice, follow_up_type, follow_up_date,
  follow_up_days, status, completed_at, created_at
)
select
  md5('meenakshi-demo-consult-' || i)::uuid,
  v.id, v.doctor_id,
  (array['Fever and body pain','Cough and sore throat','Headache','Abdominal discomfort','Routine follow-up'])[((i - 1) % 5) + 1],
  'Symptoms present for ' || (1 + i % 7) || ' days. No significant red flags reported.',
  'Patient conscious, oriented, and clinically stable.',
  (array['Viral fever','Upper respiratory tract infection','Tension headache','Acute gastritis','Stable on treatment'])[((i - 1) % 5) + 1],
  'Adequate rest, fluids, and return if symptoms worsen.',
  (case when i % 8 = 0 then 'after_report' when i % 6 = 0 then 'after_days' else 'none' end)::public.follow_up_type,
  case when i % 8 = 0 then (v.visit_date + 7) else null end,
  case when i % 6 = 0 and i % 8 <> 0 then 7 else null end,
  'completed', v.created_at + interval '55 minutes', v.created_at + interval '40 minutes'
from generate_series(1, 9000) i
join public.visits v on v.id = md5('meenakshi-demo-op-' || i)::uuid
on conflict (visit_id) do nothing;

insert into public.test_orders(
  id, patient_id, visit_id, doctor_id, test_name, status, notes, created_at
)
select
  md5('meenakshi-demo-test-' || i)::uuid,
  v.patient_id, v.id, v.doctor_id,
  (array['Complete Blood Count','Blood glucose','Liver Function Test','Renal Function Test','Lipid Profile','Chest X-Ray'])[((i - 1) % 6) + 1],
  (case when i % 4 = 0 then 'report_pending' else 'ordered' end)::public.test_order_status,
  'Demo investigation order', v.created_at + interval '50 minutes'
from generate_series(1, 3500) i
join public.visits v on v.id = md5('meenakshi-demo-op-' || i)::uuid
on conflict (id) do nothing;

-- Prescriptions are inserted as drafts first so immutable line-item rules remain valid.
insert into public.prescriptions(id, visit_id, doctor_id, status, notes, created_at)
select
  md5('meenakshi-demo-rx-' || i)::uuid,
  v.id, v.doctor_id, 'draft', 'Demo prescription', v.created_at + interval '55 minutes'
from generate_series(1, 3000) i
join public.visits v on v.id = md5('meenakshi-demo-op-' || i)::uuid
on conflict (id) do nothing;

with medicines as (
  select id, brand_name, row_number() over(order by brand_name, id) rn
  from public.medicine_directory where source = 'demo_seed_v1'
), lines as (
  select i, line_no, (((i * 2 + line_no - 2) % 300) + 1) medicine_rn
  from generate_series(1, 3000) i cross join generate_series(1, 2) line_no
)
insert into public.prescription_items(
  id, prescription_id, medicine_id, medicine_name, dose, frequency,
  duration, route, notes, requested_quantity, dispensed_quantity
)
select
  md5('meenakshi-demo-rx-line-' || l.i || '-' || l.line_no)::uuid,
  p.id, m.id, m.brand_name,
  case when l.line_no = 1 then '1 tablet' else '1 unit' end,
  case when l.line_no = 1 then '1-0-1' else '0-0-1' end,
  case when l.i % 3 = 0 then '5 days' else '3 days' end,
  'Oral', case when l.line_no = 1 then 'After food' else 'At bedtime' end,
  case when l.line_no = 1 then 10 else 5 end, 0
from lines l
join public.prescriptions p on p.id = md5('meenakshi-demo-rx-' || l.i)::uuid
join medicines m on m.rn = l.medicine_rn
on conflict (id) do nothing;

-- Historical OP visits become completed after vitals/clinical content is present.
update public.visits
set status = case
  when exists (
    select 1 from public.consultations c
    where c.visit_id = public.visits.id and c.status = 'completed'
  ) then 'completed'::public.visit_status
  when visit_date < current_date then 'completed'::public.visit_status
  when token_number % 5 = 0 then 'waiting'::public.visit_status
  when token_number % 5 = 1 then 'vitals_pending'::public.visit_status
  when token_number % 5 = 2 then 'ready'::public.visit_status
  when token_number % 5 = 3 then 'in_consultation'::public.visit_status
  else 'completed'::public.visit_status end
where id in (select md5('meenakshi-demo-op-' || i)::uuid from generate_series(1, 15000) i);

-- 1,000 linked follow-up visits; source OP visits are always historical.
with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), source as (
  select i, v.*, i % 45 day_offset
  from generate_series(1, 1000) i
  join public.visits v on v.id = md5('meenakshi-demo-op-' || (i * 2 + 1))::uuid
)
insert into public.visits(
  id, patient_id, doctor_id, department_id, visit_type, visit_date,
  token_number, fee_paise, status, related_previous_visit_id, notes,
  idempotency_key, created_by, created_at
)
select
  md5('meenakshi-demo-follow-' || s.i)::uuid,
  s.patient_id, s.doctor_id, s.department_id, 'follow_up', current_date - s.day_offset,
  500 + s.i, greatest(0, d.follow_up_fee_paise),
  case when s.day_offset = 0 then 'waiting'::public.visit_status else 'completed'::public.visit_status end,
  s.id, 'Demo linked follow-up', md5('meenakshi-demo-follow-key-' || s.i)::uuid,
  a.id,
  ((current_date - s.day_offset)::timestamp + interval '10 hours' + make_interval(mins => s.i % 300)) at time zone 'Asia/Kolkata'
from source s
join public.doctors d on d.id = s.doctor_id
cross join admin_user a
on conflict (id) do nothing;

-- Pharmacy sales for 2,000 prescriptions: 1,500 complete and 500 partial.
with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
)
insert into public.pharmacy_sales(
  id, prescription_id, patient_id, source, total_paise,
  payment_mode, idempotency_key, dispensed_by, created_at
)
select
  md5('meenakshi-demo-sale-' || i)::uuid,
  p.id, v.patient_id, 'op', 0,
  (case when i % 3 = 0 then 'cash' when i % 3 = 1 then 'upi' else 'card' end)::public.payment_mode,
  md5('meenakshi-demo-sale-key-' || i)::uuid,
  a.id, v.created_at + interval '90 minutes'
from generate_series(1, 2000) i
join public.prescriptions p on p.id = md5('meenakshi-demo-rx-' || i)::uuid
join public.visits v on v.id = p.visit_id
cross join admin_user a
on conflict (idempotency_key) do nothing;

-- amount_paise stopped being a generated column in 20260816260000_medicine_pack_size.sql
-- (it is now NOT NULL and written explicitly), and prices are per pack while
-- quantities are pieces. Both values mirror dispense_prescription()'s own
-- rounding so demo receipts add up the way real ones do.
insert into public.pharmacy_sale_items(
  id, sale_id, prescription_item_id, batch_id, quantity,
  unit_price_paise, amount_paise
)
select
  md5('meenakshi-demo-sale-line-' || i || '-' || line_no)::uuid,
  s.id, pi.id, b.id, pi.requested_quantity,
  round(b.selling_price_paise::numeric / greatest(b.units_per_pack, 1)),
  round(
    pi.requested_quantity::numeric * b.selling_price_paise
    / greatest(b.units_per_pack, 1)
  )
from generate_series(1, 2000) i
cross join generate_series(1, 2) line_no
join public.pharmacy_sales s on s.id = md5('meenakshi-demo-sale-' || i)::uuid
join public.prescription_items pi on pi.id = md5('meenakshi-demo-rx-line-' || i || '-' || line_no)::uuid
join lateral (
  select mb.id, mb.selling_price_paise, mb.units_per_pack
  from public.medicine_batches mb
  where mb.medicine_id = pi.medicine_id and mb.active and mb.expiry_date >= current_date
  order by mb.expiry_date, mb.id limit 1
) b on true
where i <= 1500 or line_no = 1
on conflict (sale_id, prescription_item_id, batch_id) do nothing;

update public.pharmacy_sales s
set total_paise = totals.total_paise
from (
  select sale_id, sum(amount_paise)::bigint total_paise
  from public.pharmacy_sale_items group by sale_id
) totals
where s.id = totals.sale_id
  and s.id in (select md5('meenakshi-demo-sale-' || i)::uuid from generate_series(1, 2000) i);

update public.prescription_items pi
set dispensed_quantity = case
  when seed.i <= 1500 then pi.requested_quantity
  when seed.line_no = 1 then pi.requested_quantity
  else 0 end
from (
  select i, line_no,
         md5('meenakshi-demo-rx-line-' || i || '-' || line_no)::uuid id
  from generate_series(1, 2000) i cross join generate_series(1, 2) line_no
) seed
where pi.id = seed.id;

update public.prescriptions p
set status = case
  when seed.i <= 1500 then 'dispensed'::public.prescription_status
  when seed.i <= 2000 then 'partially_dispensed'::public.prescription_status
  else 'pending'::public.prescription_status end
from (
  select i, md5('meenakshi-demo-rx-' || i)::uuid id
  from generate_series(1, 3000) i
) seed
where p.id = seed.id and p.status = 'draft';

-- require_settled_op_fee() (20260815200000) refuses an admission while the
-- source OP visit still owes a consultation fee. The OP seed above deliberately
-- leaves ~10% unpaid and some part-paid for realism, so settle only the 100
-- visits that go on to be admitted -- which is what reception does before
-- admitting -- and leave the rest of the outstanding mix intact.
with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), admitted as (
  select v.id, v.created_at,
         v.fee_paise - coalesce(sum(vp.amount_paise), 0) as balance
  from public.visits v
  left join public.visit_payments vp on vp.visit_id = v.id
  where v.id in (select md5('meenakshi-demo-op-' || i)::uuid from generate_series(1, 100) i)
  group by v.id, v.fee_paise, v.created_at
)
insert into public.visit_payments(
  id, visit_id, amount_paise, mode, reference, notes,
  idempotency_key, collected_by, created_at
)
select
  md5('meenakshi-demo-admission-settlement-' || ad.id)::uuid,
  ad.id, ad.balance, 'cash'::public.payment_mode,
  'DEMO-ADM-' || left(ad.id::text, 8), 'Demo pre-admission fee settlement',
  md5('meenakshi-demo-admission-settlement-key-' || ad.id)::uuid,
  a.id, ad.created_at + interval '30 minutes'
from admitted ad cross join admin_user a
where ad.balance > 0
on conflict (idempotency_key) do nothing;

-- 100 IP cases with running, discharge-pending, and completed examples.
with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), patients as (
  select id, row_number() over(order by phone_normalized) rn
  from public.patients where phone_normalized between '7000000001' and '7000010000'
), doctors as (
  select id, row_number() over(order by registration_number) rn
  from public.doctors where registration_number like 'TNMC-DEMO-%'
)
insert into public.ip_tickets(
  id, ticket_number, patient_id, doctor_id, source_visit_id,
  room, bed, admission_reason, status, admission_at,
  idempotency_key, created_by, created_at
)
select
  md5('meenakshi-demo-ip-' || i)::uuid,
  'IP-DEMO-' || lpad(i::text, 4, '0'),
  p.id, d.id, md5('meenakshi-demo-op-' || i)::uuid,
  case when i % 3 = 0 then 'Private' else 'General' end,
  'B-' || lpad(i::text, 3, '0'),
  (array['Observation for fever','Acute respiratory symptoms','Post-operative monitoring','Dehydration management','Medical observation'])[((i - 1) % 5) + 1],
  'admitted',
  now() - make_interval(days => i % 90, hours => i % 12),
  md5('meenakshi-demo-ip-key-' || i)::uuid,
  a.id, now() - make_interval(days => i % 90, hours => i % 12)
from generate_series(1, 100) i
join patients p on p.rn = i
join doctors d on d.rn = ((i - 1) % 24) + 1
cross join admin_user a
on conflict (ticket_number) do nothing;

insert into public.ip_progress_notes(
  id, ip_ticket_id, doctor_id, note, chargeable, idempotency_key, created_at
)
select
  md5('meenakshi-demo-ip-note-' || i || '-' || note_no)::uuid,
  t.id, t.doctor_id,
  case when note_no = 1 then 'Patient assessed. Vitals stable. Continue current management.'
       else 'Clinical condition reviewed. Continue monitoring and prescribed treatment.' end,
  note_no = 1, md5('meenakshi-demo-ip-note-key-' || i || '-' || note_no)::uuid,
  t.admission_at + make_interval(hours => note_no * 8)
from generate_series(1, 100) i cross join generate_series(1, 2) note_no
join public.ip_tickets t on t.id = md5('meenakshi-demo-ip-' || i)::uuid
on conflict (idempotency_key) do nothing;

with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), charge_seed as (
  select i, charge_no,
         md5('meenakshi-demo-ip-' || i)::uuid ticket_id
  from generate_series(1, 100) i cross join generate_series(1, 3) charge_no
)
insert into public.ip_charges(
  id, ip_ticket_id, category, item, quantity, rate_paise,
  source_type, source_id, idempotency_key, added_by, created_at
)
select
  md5('meenakshi-demo-ip-charge-' || s.i || '-' || s.charge_no)::uuid,
  s.ticket_id,
  (case s.charge_no when 1 then 'ward' when 2 then 'doctor' else 'treatment' end)::public.charge_category,
  case s.charge_no when 1 then 'Room / Ward charge' when 2 then 'IP Doctor Visit' else 'Nursing and treatment' end,
  case s.charge_no when 1 then 2 + (s.i % 5) when 2 then 2 else 1 end,
  case s.charge_no when 1 then 80000 when 2 then 75000 else 50000 end,
  'demo_seed', md5('meenakshi-demo-ip-charge-source-' || s.i || '-' || s.charge_no)::uuid,
  md5('meenakshi-demo-ip-charge-key-' || s.i || '-' || s.charge_no)::uuid,
  a.id, t.admission_at + make_interval(hours => s.charge_no)
from charge_seed s
join public.ip_tickets t on t.id = s.ticket_id
cross join admin_user a
on conflict (idempotency_key) do nothing;

with admin_user as (
  select id from public.profiles where email = 'admin@meenakshihospital.com' limit 1
), totals as (
  select t.id, right(t.ticket_number, 4)::integer seq,
         sum(c.amount_paise)::bigint total,
         t.admission_at
  from public.ip_tickets t join public.ip_charges c on c.ip_ticket_id = t.id
  where t.ticket_number like 'IP-DEMO-%'
  group by t.id, t.ticket_number, t.admission_at
)
insert into public.ip_payments(
  id, ip_ticket_id, amount_paise, mode, reference, notes,
  idempotency_key, collected_by, created_at
)
select
  md5('meenakshi-demo-ip-payment-' || x.seq)::uuid,
  x.id, case when x.seq > 80 then x.total else greatest(50000, x.total / 2) end,
  (case when x.seq % 2 = 0 then 'upi' else 'cash' end)::public.payment_mode,
  'IP-DEMO-' || lpad(x.seq::text, 4, '0'), 'Demo IP collection',
  md5('meenakshi-demo-ip-payment-key-' || x.seq)::uuid,
  a.id, x.admission_at + interval '2 hours'
from totals x cross join admin_user a
on conflict (idempotency_key) do nothing;

select set_config('app.ip_discharge_workflow', 'on', true);
update public.ip_tickets
set status = case
      when right(ticket_number, 4)::integer > 80 then 'discharged'::public.ip_status
      when right(ticket_number, 4)::integer > 60 then 'discharge_pending'::public.ip_status
      else 'admitted'::public.ip_status end,
    discharge_at = case when right(ticket_number, 4)::integer > 80 then now() else null end,
    final_diagnosis = case when right(ticket_number, 4)::integer > 60 then 'Improved after inpatient medical management' else null end,
    hospital_course = case when right(ticket_number, 4)::integer > 60 then 'Observed, investigated, and treated. Clinical condition improved.' else null end,
    treatment_summary = case when right(ticket_number, 4)::integer > 60 then 'Supportive care, medicines, monitoring, and specialist review.' else null end,
    discharge_medicines = case when right(ticket_number, 4)::integer > 60 then 'Continue medicines as advised in the discharge prescription.' else null end,
    discharge_advice = case when right(ticket_number, 4)::integer > 60 then 'Adequate rest, hydration, and return if symptoms recur.' else null end,
    follow_up = case when right(ticket_number, 4)::integer > 60 then 'Review after 7 days.' else null end
where ticket_number like 'IP-DEMO-%' and status <> 'discharged';

-- Pending IP prescriptions and investigations for current admissions.
insert into public.prescriptions(id, ip_ticket_id, doctor_id, status, notes, created_at)
select
  md5('meenakshi-demo-ip-rx-' || i)::uuid,
  t.id, t.doctor_id, 'draft', 'Demo IP prescription', t.admission_at + interval '3 hours'
from generate_series(1, 50) i
join public.ip_tickets t on t.id = md5('meenakshi-demo-ip-' || i)::uuid
on conflict (id) do nothing;

with medicines as (
  select id, brand_name, row_number() over(order by brand_name, id) rn
  from public.medicine_directory where source = 'demo_seed_v1'
)
insert into public.prescription_items(
  id, prescription_id, medicine_id, medicine_name, dose, frequency,
  duration, route, notes, requested_quantity, dispensed_quantity
)
select
  md5('meenakshi-demo-ip-rx-line-' || i)::uuid,
  p.id, m.id, m.brand_name, '1 tablet', '1-0-1', '5 days',
  'Oral', 'After food', 10, 0
from generate_series(1, 50) i
join public.prescriptions p on p.id = md5('meenakshi-demo-ip-rx-' || i)::uuid
join medicines m on m.rn = ((i - 1) % 300) + 1
on conflict (id) do nothing;

update public.prescriptions
set status = 'pending'
where id in (select md5('meenakshi-demo-ip-rx-' || i)::uuid from generate_series(1, 50) i)
  and status = 'draft';

insert into public.test_orders(
  id, patient_id, ip_ticket_id, doctor_id, test_name, status, notes, created_at
)
select
  md5('meenakshi-demo-ip-test-' || i)::uuid,
  t.patient_id, t.id, t.doctor_id,
  (array['Complete Blood Count','Renal Function Test','Liver Function Test','Chest X-Ray'])[((i - 1) % 4) + 1],
  'report_pending', 'Demo IP investigation', t.admission_at + interval '4 hours'
from generate_series(1, 50) i
join public.ip_tickets t on t.id = md5('meenakshi-demo-ip-' || i)::uuid
on conflict (id) do nothing;

insert into public.audit_logs(actor_user_id, action, entity_type, metadata)
select id, 'DEMO_DATA_SEEDED', 'system', jsonb_build_object(
  'dataset', 'demo_seed_v1',
  'patients', 10000,
  'op_visits', 15000,
  'follow_up_visits', 1000,
  'medicines', 300,
  'ip_tickets', 100
)
from public.profiles
where email = 'admin@meenakshihospital.com' and role = 'admin'
  and not exists (
    select 1 from public.audit_logs
    where action = 'DEMO_DATA_SEEDED' and metadata->>'dataset' = 'demo_seed_v1'
  );

commit;

analyze public.patients;
analyze public.visits;
analyze public.visit_payments;
analyze public.vitals;
analyze public.consultations;
analyze public.prescriptions;
analyze public.prescription_items;
analyze public.medicine_directory;
analyze public.medicine_batches;
analyze public.pharmacy_sales;
analyze public.ip_tickets;

select jsonb_pretty(jsonb_build_object(
  'patients', (select count(*) from public.patients),
  'departments', (select count(*) from public.departments),
  'doctors', (select count(*) from public.doctors),
  'visits', (select count(*) from public.visits),
  'medicines', (select count(*) from public.medicine_directory),
  'batches', (select count(*) from public.medicine_batches),
  'prescriptions', (select count(*) from public.prescriptions),
  'pharmacy_sales', (select count(*) from public.pharmacy_sales),
  'ip_tickets', (select count(*) from public.ip_tickets),
  'clinical_terms', (select count(*) from public.clinical_terms)
)) as seeded_counts;
