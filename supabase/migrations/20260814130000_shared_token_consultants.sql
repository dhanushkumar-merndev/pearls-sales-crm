begin;

create or replace function public.add_consultant_to_token(
  p_source_visit_id uuid,
  p_doctor_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(visit_id uuid, token_number integer)
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_source public.visits%rowtype;
  v_department uuid;
  v_fee bigint;
  v_visit uuid;
begin
  v_role:=public.current_app_role();
  if v_role not in ('admin','reception') then raise exception 'forbidden' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason required'; end if;

  select id,visits.token_number into v_visit,token_number
  from public.visits where idempotency_key=p_idempotency_key;
  if v_visit is not null then return query select v_visit,token_number; return; end if;

  select * into v_source from public.visits where id=p_source_visit_id for update;
  if not found then raise exception 'visit unavailable'; end if;
  if v_source.visit_date<>(now() at time zone 'Asia/Kolkata')::date
    or v_source.status not in ('waiting','vitals_pending','ready') then
    raise exception 'visit can no longer receive another consultant';
  end if;
  if exists(
    select 1 from public.visits
    where patient_id=v_source.patient_id and visit_date=v_source.visit_date
      and token_number=v_source.token_number and doctor_id=p_doctor_id
  ) then raise exception 'consultant already assigned'; end if;

  select department_id,
    case when v_source.visit_type='follow_up' then follow_up_fee_paise else op_fee_paise end
  into v_department,v_fee from public.doctors where id=p_doctor_id and active;
  if not found then raise exception 'consultant unavailable'; end if;

  insert into public.visits(
    patient_id,doctor_id,department_id,visit_type,visit_date,token_number,
    fee_paise,status,related_previous_visit_id,notes,idempotency_key
  ) values(
    v_source.patient_id,p_doctor_id,v_department,v_source.visit_type,
    v_source.visit_date,v_source.token_number,v_fee,v_source.status,
    v_source.related_previous_visit_id,
    concat_ws(E'\n',v_source.notes,'Additional consultant: '||trim(p_reason)),
    p_idempotency_key
  ) returning id into v_visit;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'CONSULTANT_ADDED_TO_TOKEN','visit',v_visit,jsonb_build_object(
    'source_visit_id',p_source_visit_id,'doctor_id',p_doctor_id,
    'token',v_source.token_number,'reason',trim(p_reason)
  ));
  return query select v_visit,v_source.token_number;
end $$;

revoke all on function public.add_consultant_to_token(uuid,uuid,text,uuid) from public;
grant execute on function public.add_consultant_to_token(uuid,uuid,text,uuid) to authenticated;

commit;
