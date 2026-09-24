begin;

create function public.create_multi_consultant_visit(
  p_patient_id uuid,p_visit_type public.visit_type,p_payment_mode public.payment_mode,
  p_previous_visit_id uuid,p_notes text,p_idempotency_key uuid,p_consultants jsonb
)
returns table(visit_id uuid,token_number integer)
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role; v_date date; v_token integer; v_visit uuid; v_first uuid;
  v_item jsonb; v_doctor uuid; v_department uuid; v_fee bigint; v_collected bigint;
begin
  v_role:=public.current_app_role();
  if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  select id,visits.token_number into v_visit,v_token from public.visits where idempotency_key=p_idempotency_key;
  if v_visit is not null then return query select v_visit,v_token; return; end if;
  if jsonb_typeof(p_consultants)<>'array' or jsonb_array_length(p_consultants)<1 then raise exception 'consultant required'; end if;
  if (select count(*)<>count(distinct value->>'doctor_id') from jsonb_array_elements(p_consultants)) then raise exception 'duplicate consultant'; end if;
  if p_visit_type='follow_up' and not exists(select 1 from public.visits where id=p_previous_visit_id and patient_id=p_patient_id) then raise exception 'invalid follow-up'; end if;
  v_date:=(now() at time zone 'Asia/Kolkata')::date;
  insert into public.daily_token_sequences(token_date,last_token) values(v_date,1)
  on conflict(token_date) do update set last_token=public.daily_token_sequences.last_token+1 returning last_token into v_token;
  for v_item in select value from jsonb_array_elements(p_consultants) loop
    v_doctor:=(v_item->>'doctor_id')::uuid;
    v_collected:=(v_item->>'collected_paise')::bigint;
    select department_id,case when p_visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
      into v_department,v_fee from public.doctors where id=v_doctor and active;
    if not found then raise exception 'consultant unavailable'; end if;
    if v_collected<0 or v_collected>v_fee then raise exception 'invalid payment'; end if;
    insert into public.visits(patient_id,doctor_id,department_id,visit_type,visit_date,token_number,fee_paise,status,related_previous_visit_id,notes,idempotency_key)
      values(p_patient_id,v_doctor,v_department,p_visit_type,v_date,v_token,v_fee,'waiting',p_previous_visit_id,p_notes,case when v_first is null then p_idempotency_key else gen_random_uuid() end)
      returning id into v_visit;
    if v_first is null then v_first:=v_visit; end if;
    if v_collected>0 then insert into public.visit_payments(visit_id,amount_paise,mode,idempotency_key) values(v_visit,v_collected,p_payment_mode,gen_random_uuid()); end if;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MULTI_CONSULTANT_VISIT_CREATED','visit',v_first,jsonb_build_object('token',v_token,'consultant_count',jsonb_array_length(p_consultants)));
  return query select v_first,v_token;
end $$;

revoke all on function public.create_multi_consultant_visit(uuid,public.visit_type,public.payment_mode,uuid,text,uuid,jsonb) from public;
grant execute on function public.create_multi_consultant_visit(uuid,public.visit_type,public.payment_mode,uuid,text,uuid,jsonb) to authenticated;
commit;
