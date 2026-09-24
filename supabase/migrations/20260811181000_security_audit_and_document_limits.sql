begin;

-- Patient documents are deliberately small for a fast mobile workflow.
alter table public.patient_reports drop constraint if exists patient_reports_size_bytes_check;
alter table public.patient_reports add constraint patient_reports_size_bytes_check check (size_bytes > 0 and size_bytes <= 1048576);
update storage.buckets set file_size_limit=1048576 where id='patient-documents';

create index if not exists visit_payments_history_idx on public.visit_payments(visit_id,created_at desc);
create index if not exists test_orders_patient_status_idx on public.test_orders(patient_id,status);
create index if not exists test_orders_doctor_status_idx on public.test_orders(doctor_id,status);
create index if not exists reports_visit_idx on public.patient_reports(visit_id) where visit_id is not null;
create index if not exists reports_ip_idx on public.patient_reports(ip_ticket_id) where ip_ticket_id is not null;
create index if not exists prescriptions_visit_idx on public.prescriptions(visit_id) where visit_id is not null;
create index if not exists prescription_items_parent_idx on public.prescription_items(prescription_id);
create index if not exists pharmacy_sales_created_idx on public.pharmacy_sales(created_at desc);
create index if not exists pharmacy_sales_patient_idx on public.pharmacy_sales(patient_id,created_at desc);
create index if not exists ip_charges_history_idx on public.ip_charges(ip_ticket_id,created_at desc);
create index if not exists ip_payments_history_idx on public.ip_payments(ip_ticket_id,created_at desc);
create index if not exists export_jobs_month_idx on public.export_jobs(export_month,created_at desc);
create index if not exists audit_actor_created_idx on public.audit_logs(actor_user_id,created_at desc);

-- Child rows inherit prescription ownership; a doctor cannot mutate another
-- doctor's draft merely by guessing an item UUID.
drop policy if exists prescription_items_write on public.prescription_items;
create policy prescription_items_write on public.prescription_items for all to authenticated
 using(exists(select 1 from public.prescriptions p where p.id=prescription_id and (public.current_app_role()='admin' or p.doctor_id=public.current_doctor_id())))
 with check(exists(select 1 from public.prescriptions p where p.id=prescription_id and (public.current_app_role()='admin' or p.doctor_id=public.current_doctor_id())));

drop policy if exists ip_notes_read on public.ip_progress_notes;
create policy ip_notes_read on public.ip_progress_notes for select to authenticated
 using(public.current_app_role() in ('admin','ip') or exists(select 1 from public.ip_tickets t where t.id=ip_ticket_id and t.doctor_id=public.current_doctor_id()));

-- Audit direct inserts as well as RPC workflows. The trigger writes identifiers
-- and operational amounts only, never clinical text or file contents.
create function public.audit_hospital_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;v_entity text;v_entity_id uuid;v_meta jsonb:='{}'::jsonb;
begin
 case tg_table_name
  when 'patients' then v_action:='PATIENT_CREATED';v_entity:='patient';v_entity_id:=new.id;
  when 'visit_payments' then v_action:='PAYMENT_ADDED';v_entity:='visit';v_entity_id:=new.visit_id;v_meta:=jsonb_build_object('amount_paise',new.amount_paise);
  when 'patient_reports' then v_action:='REPORT_UPLOADED';v_entity:='patient_report';v_entity_id:=new.id;
  when 'ip_charges' then v_action:='IP_CHARGE_ADDED';v_entity:='ip_ticket';v_entity_id:=new.ip_ticket_id;v_meta:=jsonb_build_object('amount_paise',new.amount_paise,'category',new.category);
  when 'ip_payments' then v_action:='IP_PAYMENT_ADDED';v_entity:='ip_ticket';v_entity_id:=new.ip_ticket_id;v_meta:=jsonb_build_object('amount_paise',new.amount_paise);
  else return new;
 end case;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),v_action,v_entity,v_entity_id,v_meta);
 return new;
end $$;
create trigger audit_patient_created after insert on public.patients for each row execute function public.audit_hospital_insert();
create trigger audit_visit_payment after insert on public.visit_payments for each row execute function public.audit_hospital_insert();
create trigger audit_patient_report after insert on public.patient_reports for each row execute function public.audit_hospital_insert();
create trigger audit_ip_charge after insert on public.ip_charges for each row execute function public.audit_hospital_insert();
create trigger audit_ip_payment after insert on public.ip_payments for each row execute function public.audit_hospital_insert();

-- Financial keys are removed at the database boundary for roles that must not
-- receive them, even when the RPC is called outside the UI.
create or replace function public.dashboard_summary() returns jsonb language sql stable security definer set search_path='' as $$
with d as (select (now() at time zone 'Asia/Kolkata')::date today),r as (select public.current_app_role() role,public.current_doctor_id() doctor_id),
s as (select jsonb_build_object(
 'patients_today',(select count(*) from public.patients,d where (created_at at time zone 'Asia/Kolkata')::date=d.today),
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
