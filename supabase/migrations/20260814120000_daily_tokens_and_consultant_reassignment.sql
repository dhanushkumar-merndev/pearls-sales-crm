begin;

create table if not exists public.daily_token_sequences (
  token_date date primary key,
  last_token integer not null check (last_token > 0)
);

insert into public.daily_token_sequences(token_date,last_token)
select visit_date,max(token_number) from public.visits group by visit_date
on conflict(token_date) do update set last_token=greatest(public.daily_token_sequences.last_token,excluded.last_token);

alter table public.daily_token_sequences enable row level security;

create or replace function public.create_visit_with_token(
  p_patient_id uuid,p_doctor_id uuid,p_visit_type public.visit_type,p_fee_paise bigint,
  p_collected_paise bigint,p_payment_mode public.payment_mode,p_previous_visit_id uuid,
  p_notes text,p_idempotency_key uuid
)
returns table(visit_id uuid,token_number integer)
language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_date date;v_token integer;v_visit uuid;v_department uuid;
begin
 v_role:=public.current_app_role();
 if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 select id,visits.token_number into v_visit,v_token from public.visits where idempotency_key=p_idempotency_key;
 if v_visit is not null then return query select v_visit,v_token;return;end if;
 if p_fee_paise<0 or p_collected_paise<0 or p_collected_paise>p_fee_paise then raise exception 'invalid payment';end if;
 if p_visit_type='follow_up' and not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id) then raise exception 'invalid follow-up';end if;
 v_date:=(now() at time zone 'Asia/Kolkata')::date;
 select department_id into v_department from public.doctors where id=p_doctor_id and active;
 if not found then raise exception 'doctor unavailable';end if;
 insert into public.daily_token_sequences(token_date,last_token) values(v_date,1)
 on conflict(token_date) do update set last_token=public.daily_token_sequences.last_token+1
 returning last_token into v_token;
 insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
 values(p_patient_id,p_doctor_id,v_department,p_visit_type,v_date,v_token,p_fee_paise,'waiting',p_previous_visit_id,p_notes,p_idempotency_key) returning id into v_visit;
 if p_collected_paise>0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,p_collected_paise,p_payment_mode,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'VISIT_CREATED','visit',v_visit,jsonb_build_object('token',v_token,'daily_serial',true));
 return query select v_visit,v_token;
end $$;

create function public.reassign_visit_consultant(p_visit_id uuid,p_doctor_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_visit public.visits%rowtype;v_department uuid;v_fee bigint;v_old_doctor uuid;v_old_fee bigint;
begin
 v_role:=public.current_app_role();
 if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason required';end if;
 select * into v_visit from public.visits where id=p_visit_id for update;
 if not found then raise exception 'visit unavailable';end if;
 if v_visit.visit_date<>(now() at time zone 'Asia/Kolkata')::date or v_visit.status not in ('waiting','vitals_pending','ready') then raise exception 'visit can no longer be reassigned';end if;
 if exists(select 1 from public.consultations where visit_id=p_visit_id)
   or exists(select 1 from public.prescriptions where visit_id=p_visit_id)
   or exists(select 1 from public.test_orders where visit_id=p_visit_id) then raise exception 'clinical work already started';end if;
 if v_visit.doctor_id=p_doctor_id then raise exception 'select a different consultant';end if;
 select department_id,case when v_visit.visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
 into v_department,v_fee from public.doctors where id=p_doctor_id and active;
 if not found then raise exception 'consultant unavailable';end if;
 v_old_doctor:=v_visit.doctor_id;v_old_fee:=v_visit.fee_paise;
 update public.visits set doctor_id=p_doctor_id,department_id=v_department,fee_paise=v_fee where id=p_visit_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'VISIT_CONSULTANT_REASSIGNED','visit',p_visit_id,jsonb_build_object('old_doctor_id',v_old_doctor,'new_doctor_id',p_doctor_id,'old_fee_paise',v_old_fee,'new_fee_paise',v_fee,'reason',trim(p_reason),'token_unchanged',v_visit.token_number));
 return p_visit_id;
end $$;

revoke all on function public.reassign_visit_consultant(uuid,uuid,text) from public;
grant execute on function public.reassign_visit_consultant(uuid,uuid,text) to authenticated;
commit;
