-- Token numbering moves from one hospital-wide daily series to a SEPARATE
-- series per doctor per day, per the client's latest requirement:
--   "if doctor token is 3 and another is 8 and if that patient wanna see both
--    then token is 4 or 9"
--
-- So Dr A runs 1,2,3,4... and Dr B runs 1,2,...,8,9... at the same time, and a
-- patient seeing both is issued TWO tokens, one from each doctor's series.
-- This supersedes the earlier hospital-wide daily serial.
--
-- visits already carries unique (doctor_id, visit_date, token_number), which is
-- exactly the right constraint for per-doctor series.
begin;

-- Rebuild the sequence table keyed by doctor as well as date.
alter table public.daily_token_sequences
  add column if not exists doctor_id uuid references public.doctors(id) on delete restrict;

delete from public.daily_token_sequences where doctor_id is null;

alter table public.daily_token_sequences drop constraint if exists daily_token_sequences_pkey;
alter table public.daily_token_sequences alter column doctor_id set not null;
alter table public.daily_token_sequences add primary key (token_date, doctor_id);

-- Seed from history so no doctor's series restarts and collides.
insert into public.daily_token_sequences(token_date, doctor_id, last_token)
select visit_date, doctor_id, max(token_number)
from public.visits
group by visit_date, doctor_id
on conflict(token_date, doctor_id)
  do update set last_token = greatest(public.daily_token_sequences.last_token, excluded.last_token);

-- Next token in one doctor's series for today. Callers already hold their own
-- transaction; the upsert serialises concurrent reception desks.
create or replace function public.next_doctor_token(p_doctor_id uuid, p_date date)
returns integer language plpgsql security definer set search_path='' as $$
declare v_token integer;
begin
  insert into public.daily_token_sequences(token_date, doctor_id, last_token)
  values(p_date, p_doctor_id, 1)
  on conflict(token_date, doctor_id)
    do update set last_token = public.daily_token_sequences.last_token + 1
  returning last_token into v_token;
  return v_token;
end $$;
revoke all on function public.next_doctor_token(uuid,date) from public;

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
 v_token:=public.next_doctor_token(p_doctor_id,v_date);
 insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
 values(p_patient_id,p_doctor_id,v_department,p_visit_type,v_date,v_token,p_fee_paise,'waiting',p_previous_visit_id,p_notes,p_idempotency_key) returning id into v_visit;
 if p_collected_paise>0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,p_collected_paise,p_payment_mode,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'VISIT_CREATED','visit',v_visit,jsonb_build_object('token',v_token,'per_doctor_series',true));
 return query select v_visit,v_token;
end $$;

-- Multi-consultant: one row per doctor, each with its OWN token number.
drop function if exists public.create_multi_consultant_visit(uuid,public.visit_type,public.payment_mode,uuid,text,uuid,jsonb);

create function public.create_multi_consultant_visit(
  p_patient_id uuid,p_visit_type public.visit_type,p_payment_mode public.payment_mode,
  p_previous_visit_id uuid,p_notes text,p_idempotency_key uuid,p_consultants jsonb
)
returns table(visit_id uuid,token_number integer,doctor_name text)
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role; v_date date; v_token integer; v_visit uuid; v_first uuid;
  v_item jsonb; v_doctor uuid; v_department uuid; v_fee bigint;
begin
  v_role:=public.current_app_role();
  if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.visits where idempotency_key=p_idempotency_key) then
    return query
      select v.id, v.token_number, d.display_name
      from public.visits v join public.doctors d on d.id=v.doctor_id
      where v.patient_id=p_patient_id and v.visit_date=(now() at time zone 'Asia/Kolkata')::date
      order by v.created_at;
    return;
  end if;
  if jsonb_typeof(p_consultants)<>'array' or jsonb_array_length(p_consultants)<1 then raise exception 'consultant required'; end if;
  if (select count(*)<>count(distinct value->>'doctor_id') from jsonb_array_elements(p_consultants)) then raise exception 'duplicate consultant'; end if;
  if p_visit_type='follow_up' and not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id) then raise exception 'invalid follow-up'; end if;
  v_date:=(now() at time zone 'Asia/Kolkata')::date;
  for v_item in select value from jsonb_array_elements(p_consultants) loop
    v_doctor:=(v_item->>'doctor_id')::uuid;
    select department_id,case when p_visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
      into v_department,v_fee from public.doctors where id=v_doctor and active;
    if not found then raise exception 'consultant unavailable'; end if;
    -- Each doctor issues from their own series.
    v_token:=public.next_doctor_token(v_doctor,v_date);
    insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
      values(p_patient_id,v_doctor,v_department,p_visit_type,v_date,v_token,0,'waiting',p_previous_visit_id,p_notes,case when v_first is null then p_idempotency_key else gen_random_uuid() end)
      returning id into v_visit;
    if v_first is null then v_first:=v_visit; end if;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MULTI_CONSULTANT_VISIT_CREATED','visit',v_first,jsonb_build_object('consultant_count',jsonb_array_length(p_consultants),'per_doctor_series',true));
  return query
    select v.id, v.token_number, d.display_name
    from public.visits v join public.doctors d on d.id=v.doctor_id
    where v.patient_id=p_patient_id and v.visit_date=v_date
    order by v.created_at;
end $$;

revoke all on function public.create_multi_consultant_visit(uuid,public.visit_type,public.payment_mode,uuid,text,uuid,jsonb) from public;
grant execute on function public.create_multi_consultant_visit(uuid,public.visit_type,public.payment_mode,uuid,text,uuid,jsonb) to authenticated;

-- Adding a second consultant now issues a token from THAT doctor's series
-- instead of copying the first doctor's number. Copying would collide with the
-- unique (doctor_id, visit_date, token_number) constraint the moment the second
-- doctor's own series reached the same number.
create or replace function public.add_consultant_to_token(
  p_source_visit_id uuid,
  p_doctor_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(visit_id uuid, token_number integer)
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role; v_source public.visits%rowtype;
  v_department uuid; v_fee bigint; v_visit uuid; v_token integer;
begin
  v_role:=public.current_app_role();
  if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason required'; end if;

  select id,visits.token_number into v_visit,v_token
  from public.visits where idempotency_key=p_idempotency_key;
  if v_visit is not null then return query select v_visit,v_token; return; end if;

  select * into v_source from public.visits where id=p_source_visit_id for update;
  if not found then raise exception 'visit unavailable'; end if;
  if v_source.visit_date<>(now() at time zone 'Asia/Kolkata')::date
    or v_source.status not in ('waiting','vitals_pending','ready') then
    raise exception 'visit can no longer receive another consultant';
  end if;
  -- Same patient, same day, same doctor is the real duplicate test now that
  -- token numbers are no longer shared between consultants.
  if exists(
    select 1 from public.visits
    where patient_id=v_source.patient_id and visit_date=v_source.visit_date
      and doctor_id=p_doctor_id
  ) then raise exception 'consultant already assigned'; end if;

  select department_id,
    case when v_source.visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
  into v_department,v_fee from public.doctors where id=p_doctor_id and active;
  if not found then raise exception 'consultant unavailable'; end if;

  v_token:=public.next_doctor_token(p_doctor_id,v_source.visit_date);

  insert into public.visits(
    patient_id,doctor_id,department_id,visit_type,visit_date,token_number,
    fee_paise,status,related_previous_visit_id,notes,idempotency_key
  ) values(
    v_source.patient_id,p_doctor_id,v_department,v_source.visit_type,
    v_source.visit_date,v_token,0,v_source.status,
    v_source.related_previous_visit_id,
    concat_ws(E'\n',v_source.notes,'Additional consultant: '||trim(p_reason)),
    p_idempotency_key
  ) returning id into v_visit;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'CONSULTANT_ADDED_TO_TOKEN','visit',v_visit,jsonb_build_object(
    'source_visit_id',p_source_visit_id,'doctor_id',p_doctor_id,
    'token',v_token,'reason',trim(p_reason)
  ));
  return query select v_visit,v_token;
end $$;

revoke all on function public.add_consultant_to_token(uuid,uuid,text,uuid) from public;
grant execute on function public.add_consultant_to_token(uuid,uuid,text,uuid) to authenticated;

-- Reassignment must also re-issue: the old number belongs to the old doctor's
-- series, and keeping it would both collide and mislead the queue.
create or replace function public.reassign_visit_consultant(p_visit_id uuid,p_doctor_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_visit public.visits%rowtype;v_department uuid;v_fee bigint;v_old_doctor uuid;v_token integer;
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
 v_old_doctor:=v_visit.doctor_id;
 v_token:=public.next_doctor_token(p_doctor_id,v_visit.visit_date);
 update public.visits set doctor_id=p_doctor_id,department_id=v_department,token_number=v_token where id=p_visit_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'VISIT_CONSULTANT_REASSIGNED','visit',p_visit_id,jsonb_build_object(
   'from_doctor',v_old_doctor,'to_doctor',p_doctor_id,'old_token',v_visit.token_number,'new_token',v_token,'reason',trim(p_reason)));
 return p_visit_id;
end $$;

revoke all on function public.reassign_visit_consultant(uuid,uuid,text) from public;
grant execute on function public.reassign_visit_consultant(uuid,uuid,text) to authenticated;

commit;
