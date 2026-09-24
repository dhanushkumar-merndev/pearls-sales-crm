-- A visit must not consume an unrelated future appointment for the patient.
-- Multiple consultant tokens created in one transaction represent one arrival.
create or replace function public.convert_booked_lead_on_visit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lead uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('lead-arrival:' || new.patient_id::text, 0));
  if exists (
    select 1 from public.leads l join public.visits v on v.id=l.converted_visit_id
    where l.patient_id=new.patient_id and v.created_at=new.created_at
  ) then return new; end if;
  select l.id into v_lead from public.leads l
  where l.patient_id=new.patient_id and l.status='booked'
    and (l.appointment_at at time zone 'Asia/Kolkata')::date=new.visit_date
  order by abs(extract(epoch from (l.appointment_at-new.created_at))),l.id
  limit 1 for update;
  if v_lead is null then return new; end if;
  update public.leads set status='converted',converted_visit_id=new.id,
    converted_at=now(),next_follow_up_at=null where id=v_lead;
  insert into public.lead_activities(lead_id,type,body,from_status,to_status,created_by)
  values(v_lead,'status_change','Visit created at reception','booked','converted',auth.uid());
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'LEAD_CONVERTED','lead',v_lead,jsonb_build_object('visit_id',new.id));
  return new;
end $$;
revoke execute on function public.convert_booked_lead_on_visit() from public,anon,authenticated;

-- Closed enquiries may retain notes, but cannot acquire new follow-up work.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.add_lead_note(uuid,text,text,timestamptz,boolean)'::regprocedure);
  definition := replace(definition,
    'select status into v_status from public.leads where id = p_lead_id for update;',
    'select status into v_status from public.leads where id = p_lead_id for update;
     if v_status = ''converted'' and p_next_follow_up_at is not null then
       raise exception ''A converted lead is closed.'' using errcode = ''22023'';
     end if;');
  execute definition;
end $$;
