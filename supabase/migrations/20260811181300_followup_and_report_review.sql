begin;
create unique index one_follow_up_per_previous_visit on public.visits(related_previous_visit_id) where visit_type='follow_up';

create function public.validate_report_relationship() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.visit_id is not null and not exists(select 1 from public.visits where id=new.visit_id and patient_id=new.patient_id) then raise exception 'report visit does not belong to patient';end if;
 if new.ip_ticket_id is not null and not exists(select 1 from public.ip_tickets where id=new.ip_ticket_id and patient_id=new.patient_id) then raise exception 'report IP ticket does not belong to patient';end if;
 if new.test_order_id is not null and not exists(select 1 from public.test_orders where id=new.test_order_id and patient_id=new.patient_id and visit_id is not distinct from new.visit_id and ip_ticket_id is not distinct from new.ip_ticket_id) then raise exception 'report test order relationship is invalid';end if;
 if new.test_order_id is not null then update public.test_orders set status='report_ready' where id=new.test_order_id and status in ('ordered','report_pending');end if;
 return new;
end $$;
create trigger validate_report_relationship before insert on public.patient_reports for each row execute function public.validate_report_relationship();

create or replace function public.create_visit_with_token(p_patient_id uuid,p_doctor_id uuid,p_visit_type public.visit_type,p_fee_paise bigint,p_collected_paise bigint,p_payment_mode public.payment_mode,p_previous_visit_id uuid,p_notes text,p_idempotency_key uuid)
returns table(visit_id uuid,token_number integer) language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_date date;v_token integer;v_visit uuid;v_department uuid;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 if p_fee_paise<0 or p_collected_paise<0 or p_collected_paise>p_fee_paise then raise exception 'invalid payment';end if;
 select id,visits.token_number into v_visit,v_token from public.visits where idempotency_key=p_idempotency_key;if v_visit is not null then return query select v_visit,v_token;return;end if;
 if p_visit_type='follow_up' then
  if p_previous_visit_id is null or not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id and status='completed') then raise exception 'valid completed previous visit is required';end if;
 elsif p_previous_visit_id is not null then raise exception 'OP visits cannot link a previous visit';end if;
 v_date:=(now() at time zone 'Asia/Kolkata')::date;
 select department_id into v_department from public.doctors where id=p_doctor_id and active;if not found then raise exception 'doctor unavailable';end if;
 insert into public.token_sequences(doctor_id,token_date,last_token) values(p_doctor_id,v_date,1) on conflict(doctor_id,token_date) do update set last_token=public.token_sequences.last_token+1 returning last_token into v_token;
 insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key) values(p_patient_id,p_doctor_id,v_department,p_visit_type,v_date,v_token,p_fee_paise,'waiting',p_previous_visit_id,p_notes,p_idempotency_key) returning id into v_visit;
 if p_collected_paise>0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,p_collected_paise,p_payment_mode,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'VISIT_CREATED','visit',v_visit,jsonb_build_object('token',v_token,'type',p_visit_type));
 return query select v_visit,v_token;
end $$;

create function public.review_patient_report(p_report_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;v_test uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 select r.test_order_id into v_test from public.patient_reports r left join public.visits v on v.id=r.visit_id left join public.test_orders t on t.id=r.test_order_id left join public.ip_tickets i on i.id=r.ip_ticket_id where r.id=p_report_id and (v_role='admin' or v.doctor_id=v_doctor or t.doctor_id=v_doctor or i.doctor_id=v_doctor) for update of r;
 if not found then raise exception 'report unavailable' using errcode='42501';end if;
 update public.patient_reports set status='reviewed' where id=p_report_id;
 if v_test is not null then update public.test_orders set status='reviewed' where id=v_test;end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'REPORT_REVIEWED','patient_report',p_report_id);
 return p_report_id;
end $$;
revoke all on function public.review_patient_report(uuid) from public;
grant execute on function public.review_patient_report(uuid) to authenticated;
commit;
