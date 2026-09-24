begin;

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('admin','reception','op','doctor','ip','pharmacy');
create type public.record_status as enum ('active','inactive');
create type public.patient_status as enum ('active','archived');
create type public.gender as enum ('male','female','other','unknown');
create type public.visit_type as enum ('op','follow_up');
create type public.visit_status as enum ('waiting','vitals_pending','ready','in_consultation','completed','cancelled');
create type public.payment_mode as enum ('cash','upi','card','bank_transfer','other');
create type public.consultation_status as enum ('draft','completed','amended');
create type public.follow_up_type as enum ('none','after_report','specific_date','after_days');
create type public.test_order_status as enum ('ordered','report_pending','report_ready','reviewed','cancelled');
create type public.report_status as enum ('pending','ready','reviewed','archived');
create type public.prescription_status as enum ('draft','pending','partially_dispensed','dispensed','cancelled');
create type public.ip_status as enum ('admitted','discharge_pending','discharged','cancelled');
create type public.charge_category as enum ('doctor','ward','room','bed','treatment','test','pharmacy','other');
create type public.sale_source as enum ('op','ip');
create type public.job_status as enum ('queued','processing','ready','failed','expired');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) >= 2),
  email text not null,
  role public.app_role not null,
  status public.record_status not null default 'active',
  doctor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete restrict,
  display_name text not null,
  department_id uuid references public.departments(id) on delete restrict,
  specialization text,
  qualification text,
  registration_number text unique,
  op_fee_paise bigint not null default 0 check (op_fee_paise >= 0),
  follow_up_fee_paise bigint not null default 0 check (follow_up_fee_paise >= 0),
  ip_visit_fee_paise bigint not null default 0 check (ip_visit_fee_paise >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add constraint profiles_doctor_id_fkey foreign key (doctor_id) references public.doctors(id) on delete set null;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique check (phone_normalized ~ '^[6-9][0-9]{9}$'),
  name text not null check (length(trim(name)) >= 2),
  name_normalized text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  dob date,
  gender public.gender not null default 'unknown',
  address text,
  blood_group text,
  allergies text,
  notes text,
  status public.patient_status not null default 'active',
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.token_sequences (
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  token_date date not null,
  last_token integer not null check (last_token > 0),
  primary key (doctor_id, token_date)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  department_id uuid references public.departments(id) on delete restrict,
  visit_type public.visit_type not null,
  visit_date date not null,
  token_number integer not null check (token_number > 0),
  fee_paise bigint not null check (fee_paise >= 0),
  status public.visit_status not null default 'waiting',
  related_previous_visit_id uuid references public.visits(id) on delete restrict,
  notes text,
  idempotency_key uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, visit_date, token_number),
  check ((visit_type = 'follow_up' and related_previous_visit_id is not null) or visit_type = 'op')
);

create table public.visit_payments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  mode public.payment_mode not null,
  reference text,
  notes text,
  idempotency_key uuid not null unique,
  collected_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.vitals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.visits(id) on delete restrict,
  weight_kg numeric(6,2) check (weight_kg > 0), height_cm numeric(6,2) check (height_cm > 0),
  temperature_c numeric(4,1), bp_systolic smallint, bp_diastolic smallint, pulse smallint, spo2 smallint,
  respiratory_rate smallint, notes text,
  recorded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (spo2 is null or spo2 between 1 and 100)
);

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.visits(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  symptoms text, history text, examination text, assessment text, advice text,
  follow_up_type public.follow_up_type not null default 'none', follow_up_date date, follow_up_days integer,
  status public.consultation_status not null default 'draft', completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.clinical_terms (
  id uuid primary key default gen_random_uuid(), term_type text not null, display_text text not null,
  normalized_text text generated always as (lower(regexp_replace(trim(display_text), '\s+', ' ', 'g'))) stored,
  search_aliases text[] not null default '{}', active boolean not null default true,
  source text not null default 'hospital', source_license text, source_version text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (term_type, normalized_text)
);

create table public.medicine_directory (
  id uuid primary key default gen_random_uuid(), brand_name text not null, generic_name text, strength text,
  dosage_form text not null, manufacturer text,
  search_text text generated always as (lower(trim(brand_name || ' ' || coalesce(generic_name,'') || ' ' || coalesce(strength,'') || ' ' || dosage_form || ' ' || coalesce(manufacturer,'')))) stored,
  active boolean not null default true, source text not null default 'hospital', source_license text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (brand_name, generic_name, strength, dosage_form)
);

create table public.medicine_batches (
  id uuid primary key default gen_random_uuid(), medicine_id uuid not null references public.medicine_directory(id) on delete restrict,
  batch_number text not null, expiry_date date not null, quantity integer not null default 0 check (quantity >= 0),
  purchase_price_paise bigint check (purchase_price_paise >= 0), selling_price_paise bigint not null check (selling_price_paise >= 0),
  low_stock_threshold integer not null default 10 check (low_stock_threshold >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (medicine_id, batch_number)
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(), visit_id uuid unique references public.visits(id) on delete restrict,
  ip_ticket_id uuid, doctor_id uuid not null references public.doctors(id) on delete restrict,
  status public.prescription_status not null default 'draft', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.prescription_items (
  id uuid primary key default gen_random_uuid(), prescription_id uuid not null references public.prescriptions(id) on delete restrict,
  medicine_id uuid references public.medicine_directory(id) on delete restrict, medicine_name text not null,
  dose text, frequency text, duration text, route text, notes text,
  requested_quantity integer not null default 1 check (requested_quantity > 0),
  dispensed_quantity integer not null default 0 check (dispensed_quantity >= 0 and dispensed_quantity <= requested_quantity),
  created_at timestamptz not null default now()
);

create table public.test_orders (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete restrict, ip_ticket_id uuid,
  doctor_id uuid not null references public.doctors(id) on delete restrict, test_name text not null,
  status public.test_order_status not null default 'ordered', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.report_categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.patient_reports (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete restrict, ip_ticket_id uuid,
  test_order_id uuid references public.test_orders(id) on delete restrict, category_id uuid references public.report_categories(id) on delete restrict,
  report_name text not null, report_date date not null, display_name text not null, original_filename text not null,
  object_path text not null unique, mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760), notes text,
  status public.report_status not null default 'ready', uploaded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.ip_tickets (
  id uuid primary key default gen_random_uuid(), ticket_number text not null unique,
  patient_id uuid not null references public.patients(id) on delete restrict, doctor_id uuid not null references public.doctors(id) on delete restrict,
  source_visit_id uuid references public.visits(id) on delete restrict, room text, bed text, admission_reason text,
  status public.ip_status not null default 'admitted', admission_at timestamptz not null default now(), discharge_at timestamptz,
  final_diagnosis text, hospital_course text, discharge_advice text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (discharge_at is null or discharge_at >= admission_at)
);
alter table public.prescriptions add constraint prescriptions_ip_ticket_id_fkey foreign key (ip_ticket_id) references public.ip_tickets(id) on delete restrict;
alter table public.test_orders add constraint test_orders_ip_ticket_id_fkey foreign key (ip_ticket_id) references public.ip_tickets(id) on delete restrict;
alter table public.patient_reports add constraint patient_reports_ip_ticket_id_fkey foreign key (ip_ticket_id) references public.ip_tickets(id) on delete restrict;

create sequence if not exists public.ip_ticket_sequence;
create table public.ip_progress_notes (
  id uuid primary key default gen_random_uuid(), ip_ticket_id uuid not null references public.ip_tickets(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict, note text not null,
  chargeable boolean not null default false, idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);
create table public.ip_charges (
  id uuid primary key default gen_random_uuid(), ip_ticket_id uuid not null references public.ip_tickets(id) on delete restrict,
  category public.charge_category not null, item text not null, quantity integer not null default 1 check (quantity > 0),
  rate_paise bigint not null check (rate_paise >= 0), amount_paise bigint generated always as (quantity * rate_paise) stored,
  source_type text, source_id uuid, idempotency_key uuid not null unique,
  added_by uuid not null default auth.uid() references public.profiles(id) on delete restrict, created_at timestamptz not null default now(),
  unique nulls not distinct (source_type, source_id)
);
create table public.ip_payments (
  id uuid primary key default gen_random_uuid(), ip_ticket_id uuid not null references public.ip_tickets(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0), mode public.payment_mode not null, reference text, notes text,
  idempotency_key uuid not null unique, collected_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.pharmacy_sales (
  id uuid primary key default gen_random_uuid(), prescription_id uuid not null references public.prescriptions(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, source public.sale_source not null,
  ip_ticket_id uuid references public.ip_tickets(id) on delete restrict, total_paise bigint not null default 0 check (total_paise >= 0),
  payment_mode public.payment_mode, idempotency_key uuid not null unique,
  dispensed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict, created_at timestamptz not null default now()
);
create table public.pharmacy_sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.pharmacy_sales(id) on delete restrict,
  prescription_item_id uuid not null references public.prescription_items(id) on delete restrict,
  batch_id uuid not null references public.medicine_batches(id) on delete restrict, quantity integer not null check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0), amount_paise bigint generated always as (quantity * unit_price_paise) stored,
  unique (sale_id, prescription_item_id, batch_id)
);

create table public.hospital_settings (id boolean primary key default true check (id), hospital_name text not null default 'Meenakshi Hospital', address text, phone text, email text, logo_path text, prescription_footer text, token_footer text, digital_prescription_text text, updated_at timestamptz not null default now());
create table public.charges (id uuid primary key default gen_random_uuid(), category text not null, charge_name text not null, amount_paise bigint not null check(amount_paise >= 0), active boolean not null default true, unique(category,charge_name));
create table public.bulk_import_jobs (id uuid primary key default gen_random_uuid(), file_name text not null, row_count integer not null, success_count integer not null default 0, error_count integer not null default 0, status public.job_status not null default 'queued', created_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now(), completed_at timestamptz);
create table public.bulk_import_errors (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.bulk_import_jobs(id) on delete restrict, row_number integer not null, row_data jsonb not null, errors text[] not null);
create table public.export_jobs (id uuid primary key default gen_random_uuid(), export_month date not null, include_documents boolean not null default false, status public.job_status not null default 'queued', object_path text, size_bytes bigint, expires_at timestamptz, created_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now(), completed_at timestamptz);
create table public.audit_logs (id bigint generated always as identity primary key, actor_user_id uuid references public.profiles(id) on delete restrict, action text not null, entity_type text, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

create index patients_phone_idx on public.patients(phone_normalized);
create index patients_name_idx on public.patients(name_normalized text_pattern_ops);
create index visits_patient_history_idx on public.visits(patient_id, created_at desc);
create index visits_doctor_queue_idx on public.visits(doctor_id, visit_date, status);
create index clinical_terms_search_idx on public.clinical_terms(term_type, normalized_text text_pattern_ops) where active;
create index medicine_search_idx on public.medicine_directory(search_text text_pattern_ops) where active;
create index medicine_batch_fefo_idx on public.medicine_batches(medicine_id, expiry_date) where active and quantity > 0;
create index reports_patient_idx on public.patient_reports(patient_id, created_at desc);
create index ip_patient_idx on public.ip_tickets(patient_id, admission_at desc);
create index ip_doctor_idx on public.ip_tickets(doctor_id, status);
create index audit_created_idx on public.audit_logs(created_at desc);

create function public.current_app_role() returns public.app_role language sql stable security definer set search_path = '' as $$ select role from public.profiles where id = auth.uid() and status = 'active' $$;
create function public.current_doctor_id() returns uuid language sql stable security definer set search_path = '' as $$ select doctor_id from public.profiles where id = auth.uid() and status = 'active' $$;
revoke all on function public.current_app_role() from public; grant execute on function public.current_app_role() to authenticated;
revoke all on function public.current_doctor_id() from public; grant execute on function public.current_doctor_id() to authenticated;

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['departments','profiles','doctors','patients','visits','vitals','consultations','clinical_terms','medicine_directory','medicine_batches','prescriptions','test_orders','patient_reports','ip_tickets'] loop execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t); end loop; end $$;

create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,full_name,email,role,status) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),new.email,coalesce((new.raw_user_meta_data->>'role')::public.app_role,'reception'),'active');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create function public.create_visit_with_token(p_patient_id uuid,p_doctor_id uuid,p_visit_type public.visit_type,p_fee_paise bigint,p_collected_paise bigint,p_payment_mode public.payment_mode,p_previous_visit_id uuid,p_notes text,p_idempotency_key uuid)
returns table(visit_id uuid,token_number integer) language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_date date; v_token integer; v_visit uuid; v_department uuid;
begin
  v_role := public.current_app_role(); if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_fee_paise < 0 or p_collected_paise < 0 or p_collected_paise > p_fee_paise then raise exception 'invalid payment'; end if;
  select id,token_number into v_visit,v_token from public.visits where idempotency_key=p_idempotency_key;
  if v_visit is not null then return query select v_visit,v_token; return; end if;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  select department_id into v_department from public.doctors where id=p_doctor_id and active;
  if not found then raise exception 'doctor unavailable'; end if;
  insert into public.token_sequences(doctor_id,token_date,last_token) values(p_doctor_id,v_date,1)
  on conflict(doctor_id,token_date) do update set last_token=public.token_sequences.last_token+1 returning last_token into v_token;
  insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
  values(p_patient_id,p_doctor_id,v_department,p_visit_type,v_date,v_token,p_fee_paise,'waiting',p_previous_visit_id,p_notes,p_idempotency_key) returning id into v_visit;
  if p_collected_paise > 0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,p_collected_paise,p_payment_mode,p_idempotency_key); end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'VISIT_CREATED','visit',v_visit,jsonb_build_object('token',v_token));
  return query select v_visit,v_token;
end $$;

create function public.dashboard_summary() returns jsonb language sql stable security definer set search_path = '' as $$
with d as (select (now() at time zone 'Asia/Kolkata')::date today), r as (select public.current_app_role() role, public.current_doctor_id() doctor_id)
select jsonb_build_object(
 'patients_today',(select count(*) from public.patients,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'visits_today',(select count(*) from public.visits v,d,r where v.visit_date=d.today and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'waiting',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status in ('waiting','vitals_pending') and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'ready',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status='ready' and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'completed',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status='completed' and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'vitals_pending',(select count(*) from public.visits,d where visit_date=d.today and status in ('waiting','vitals_pending')),
 'current_ip',(select count(*) from public.ip_tickets i,r where i.status='admitted' and (r.role<>'doctor' or i.doctor_id=r.doctor_id)),
 'admissions_today',(select count(*) from public.ip_tickets,d where (admission_at at time zone 'Asia/Kolkata')::date=d.today),
 'discharges_today',(select count(*) from public.ip_tickets,d where discharge_at is not null and (discharge_at at time zone 'Asia/Kolkata')::date=d.today),
 'reports_ready',(select count(*) from public.patient_reports where status='ready'),
 'reports_pending',(select count(*) from public.test_orders where status in ('ordered','report_pending')),
 'pending_prescriptions',(select count(*) from public.prescriptions where status in ('pending','partially_dispensed')),
 'low_stock',(select count(*) from public.medicine_batches where active and quantity between 1 and low_stock_threshold),
 'out_of_stock',(select count(*) from public.medicine_batches where active and quantity=0),
 'dispensed_today',(select count(*) from public.pharmacy_sales,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'collected_today_paise',(select coalesce(sum(amount_paise),0) from public.visit_payments,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'pharmacy_sales_today_paise',(select coalesce(sum(total_paise),0) from public.pharmacy_sales,d where (created_at at time zone 'Asia/Kolkata')::date=d.today)
) $$;

alter table public.profiles enable row level security; alter table public.departments enable row level security; alter table public.doctors enable row level security;
alter table public.patients enable row level security; alter table public.visits enable row level security; alter table public.visit_payments enable row level security; alter table public.vitals enable row level security; alter table public.consultations enable row level security;
alter table public.clinical_terms enable row level security; alter table public.medicine_directory enable row level security; alter table public.medicine_batches enable row level security; alter table public.prescriptions enable row level security; alter table public.prescription_items enable row level security;
alter table public.test_orders enable row level security; alter table public.report_categories enable row level security; alter table public.patient_reports enable row level security;
alter table public.ip_tickets enable row level security; alter table public.ip_progress_notes enable row level security; alter table public.ip_charges enable row level security; alter table public.ip_payments enable row level security;
alter table public.pharmacy_sales enable row level security; alter table public.pharmacy_sale_items enable row level security; alter table public.hospital_settings enable row level security; alter table public.charges enable row level security;
alter table public.bulk_import_jobs enable row level security; alter table public.bulk_import_errors enable row level security; alter table public.export_jobs enable row level security; alter table public.audit_logs enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using (id=auth.uid() or public.current_app_role()='admin');
create policy admin_profiles_all on public.profiles for all to authenticated using (public.current_app_role()='admin') with check (public.current_app_role()='admin');
create policy authenticated_departments_read on public.departments for select to authenticated using (true); create policy admin_departments_all on public.departments for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy authenticated_doctors_read on public.doctors for select to authenticated using (true); create policy admin_doctors_all on public.doctors for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy clinical_roles_patients_read on public.patients for select to authenticated using(public.current_app_role() in ('admin','reception','op','doctor','ip'));
create policy reception_patients_write on public.patients for insert to authenticated with check(public.current_app_role() in ('admin','reception','ip'));
create policy reception_patients_update on public.patients for update to authenticated using(public.current_app_role() in ('admin','reception','ip')) with check(public.current_app_role() in ('admin','reception','ip'));
create policy visits_read on public.visits for select to authenticated using(public.current_app_role() in ('admin','reception','op','ip') or (public.current_app_role()='doctor' and doctor_id=public.current_doctor_id()));
create policy visit_payments_finance on public.visit_payments for select to authenticated using(public.current_app_role() in ('admin','reception')); create policy visit_payments_insert on public.visit_payments for insert to authenticated with check(public.current_app_role() in ('admin','reception'));
create policy vitals_read on public.vitals for select to authenticated using(public.current_app_role() in ('admin','reception','op','doctor','ip')); create policy vitals_write on public.vitals for all to authenticated using(public.current_app_role() in ('admin','op','doctor')) with check(public.current_app_role() in ('admin','op','doctor'));
create policy consultations_read on public.consultations for select to authenticated using(public.current_app_role() in ('admin','doctor','op','ip')); create policy consultations_doctor_write on public.consultations for all to authenticated using(public.current_app_role()='admin' or doctor_id=public.current_doctor_id()) with check(public.current_app_role()='admin' or doctor_id=public.current_doctor_id());
create policy directory_read on public.clinical_terms for select to authenticated using(active or public.current_app_role()='admin'); create policy directory_admin on public.clinical_terms for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy medicines_read on public.medicine_directory for select to authenticated using(active or public.current_app_role() in ('admin','pharmacy')); create policy medicines_manage on public.medicine_directory for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy'));
create policy batches_availability_read on public.medicine_batches for select to authenticated using(public.current_app_role() in ('admin','doctor','pharmacy')); create policy batches_manage on public.medicine_batches for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy'));
create policy prescriptions_read on public.prescriptions for select to authenticated using(public.current_app_role() in ('admin','pharmacy') or doctor_id=public.current_doctor_id()); create policy prescriptions_doctor_write on public.prescriptions for all to authenticated using(public.current_app_role()='admin' or doctor_id=public.current_doctor_id()) with check(public.current_app_role()='admin' or doctor_id=public.current_doctor_id());
create policy prescription_items_read on public.prescription_items for select to authenticated using(exists(select 1 from public.prescriptions p where p.id=prescription_id)); create policy prescription_items_write on public.prescription_items for all to authenticated using(public.current_app_role() in ('admin','doctor')) with check(public.current_app_role() in ('admin','doctor'));
create policy tests_read on public.test_orders for select to authenticated using(public.current_app_role() in ('admin','reception','op','doctor','ip')); create policy tests_doctor_write on public.test_orders for all to authenticated using(public.current_app_role()='admin' or doctor_id=public.current_doctor_id()) with check(public.current_app_role()='admin' or doctor_id=public.current_doctor_id());
create policy report_categories_read on public.report_categories for select to authenticated using(true); create policy report_categories_admin on public.report_categories for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy reports_read on public.patient_reports for select to authenticated using(public.current_app_role() in ('admin','reception','op','doctor','ip')); create policy reports_upload on public.patient_reports for insert to authenticated with check(public.current_app_role() in ('admin','reception','op','ip'));
create policy ip_read on public.ip_tickets for select to authenticated using(public.current_app_role() in ('admin','ip') or (public.current_app_role()='doctor' and doctor_id=public.current_doctor_id())); create policy ip_manage on public.ip_tickets for all to authenticated using(public.current_app_role() in ('admin','ip')) with check(public.current_app_role() in ('admin','ip'));
create policy ip_notes_read on public.ip_progress_notes for select to authenticated using(public.current_app_role() in ('admin','ip','doctor')); create policy ip_notes_doctor on public.ip_progress_notes for insert to authenticated with check(public.current_app_role()='admin' or doctor_id=public.current_doctor_id());
create policy ip_charges_read on public.ip_charges for select to authenticated using(public.current_app_role() in ('admin','ip')); create policy ip_charges_write on public.ip_charges for insert to authenticated with check(public.current_app_role() in ('admin','ip','pharmacy'));
create policy ip_payments_role on public.ip_payments for all to authenticated using(public.current_app_role() in ('admin','ip')) with check(public.current_app_role() in ('admin','ip'));
create policy pharmacy_sales_role on public.pharmacy_sales for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy')); create policy pharmacy_items_role on public.pharmacy_sale_items for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy'));
create policy settings_read on public.hospital_settings for select to authenticated using(true); create policy settings_admin on public.hospital_settings for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy charges_read on public.charges for select to authenticated using(true); create policy charges_admin on public.charges for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create policy imports_role on public.bulk_import_jobs for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy')); create policy import_errors_role on public.bulk_import_errors for all to authenticated using(public.current_app_role() in ('admin','pharmacy')) with check(public.current_app_role() in ('admin','pharmacy'));
create policy exports_admin on public.export_jobs for all to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin'); create policy audit_admin on public.audit_logs for select to authenticated using(public.current_app_role()='admin');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('patient-documents','patient-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']),('hospital-exports','hospital-exports',false,536870912,array['application/zip']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists patient_documents_read on storage.objects;
drop policy if exists patient_documents_upload on storage.objects;
drop policy if exists exports_storage_admin on storage.objects;
create policy patient_documents_read on storage.objects for select to authenticated using(bucket_id='patient-documents' and public.current_app_role() in ('admin','reception','op','doctor','ip'));
create policy patient_documents_upload on storage.objects for insert to authenticated with check(bucket_id='patient-documents' and public.current_app_role() in ('admin','reception','op','ip'));
create policy exports_storage_admin on storage.objects for all to authenticated using(bucket_id='hospital-exports' and public.current_app_role()='admin') with check(bucket_id='hospital-exports' and public.current_app_role()='admin');

grant usage on schema public to authenticated; grant select,insert,update on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.create_visit_with_token(uuid,uuid,public.visit_type,bigint,bigint,public.payment_mode,uuid,text,uuid) to authenticated;
grant execute on function public.dashboard_summary() to authenticated;

commit;
