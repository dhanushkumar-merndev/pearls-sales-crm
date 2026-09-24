-- The dashboard card labelled "Patients Today" counted patients whose RECORD
-- was created today -- new registrations, not attendance. That is why admin
-- could read "Patients Today 2" while "OP Visits Today" read 4.
--
-- Adds patients_seen_today (DISTINCT patients with a visit today). The existing
-- patients_today key is kept and relabelled "New Patients Today" in the UI.
-- Counting distinct patient_id also keeps headcount separate from workload now
-- that a patient seeing two doctors has two visits and two tokens.
begin;

create or replace function public.dashboard_summary() returns jsonb language sql stable security definer set search_path='' as $$
with d as (select (now() at time zone 'Asia/Kolkata')::date today),r as (select public.current_app_role() role,public.current_doctor_id() doctor_id),
s as (select jsonb_build_object(
 'patients_today',(select count(*) from public.patients,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'patients_seen_today',(select count(distinct v.patient_id) from public.visits v,d,r where v.visit_date=d.today and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'visits_today',(select count(*) from public.visits v,d,r where v.visit_date=d.today and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'waiting',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status in ('waiting','vitals_pending') and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'ready',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status='ready' and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'completed',(select count(*) from public.visits v,d,r where v.visit_date=d.today and v.status='completed' and (r.role<>'doctor' or v.doctor_id=r.doctor_id)),
 'vitals_pending',(select count(*) from public.visits,d where visit_date=d.today and status in ('waiting','vitals_pending')),
 'current_ip',(select count(*) from public.ip_tickets i,r where i.status in ('admitted','discharge_pending') and (r.role<>'doctor' or i.doctor_id=r.doctor_id)),
 'admissions_today',(select count(*) from public.ip_tickets,d where (admission_at at time zone 'Asia/Kolkata')::date=d.today),
 'discharges_today',(select count(*) from public.ip_tickets,d where discharge_at is not null and (discharge_at at time zone 'Asia/Kolkata')::date=d.today),
 'discharge_pending',(select count(*) from public.ip_tickets where status='discharge_pending'),
 'reports_ready',(select count(*) from public.patient_reports where status='ready'),
 'reports_pending',(select count(*) from public.test_orders where status in ('ordered','report_pending')),
 'followups_due',(select count(*) from public.consultations,d where follow_up_type<>'none' and status='completed' and (follow_up_date is null or follow_up_date<=d.today)),
 'pending_prescriptions',(select count(*) from public.prescriptions where status in ('pending','partially_dispensed')),
 'low_stock',(select count(*) from public.medicine_batches where active and quantity between 1 and low_stock_threshold),
 'out_of_stock',(select count(*) from public.medicine_batches where active and quantity=0),
 'expiring_soon',(select count(*) from public.medicine_batches where active and quantity>0 and expiry_date between current_date and current_date+30),
 'dispensed_today',(select count(*) from public.pharmacy_sales,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'op_collection_paise',(select coalesce(sum(amount_paise),0) from public.visit_payments,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'ip_collection_paise',(select coalesce(sum(amount_paise),0) from public.ip_payments,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'pharmacy_sales_today_paise',(select coalesce(sum(total_paise),0) from public.pharmacy_sales,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
 'ip_balance_paise',(select greatest(0,coalesce((select sum(amount_paise) from public.ip_charges),0)-coalesce((select sum(amount_paise) from public.ip_payments),0))),
 'collected_today_paise',(select coalesce((select sum(amount_paise) from public.visit_payments,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),0)+coalesce((select sum(amount_paise) from public.ip_payments,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),0)+coalesce((select sum(total_paise) from public.pharmacy_sales,d where source='op' and (created_at at time zone 'Asia/Kolkata')::date=d.today),0))
 ) as payload from r)
select case (select role from r)
 when 'admin' then payload
 when 'reception' then payload-array['ip_collection_paise','pharmacy_sales_today_paise','ip_balance_paise']
 when 'ip' then payload-array['op_collection_paise','pharmacy_sales_today_paise','collected_today_paise']
 when 'pharmacy' then payload-array['op_collection_paise','ip_collection_paise','ip_balance_paise','collected_today_paise']
 else payload-array['op_collection_paise','ip_collection_paise','pharmacy_sales_today_paise','ip_balance_paise','collected_today_paise'] end from s
$$;

commit;
