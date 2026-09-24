begin;

create function public.record_visit_vitals(
  p_visit_id uuid, p_weight_kg numeric, p_height_cm numeric, p_temperature_c numeric,
  p_bp_systolic smallint, p_bp_diastolic smallint, p_pulse smallint, p_spo2 smallint,
  p_respiratory_rate smallint, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_id uuid;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','op') then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.visits where id=p_visit_id and status not in ('completed','cancelled')) then raise exception 'visit unavailable'; end if;
  insert into public.vitals(visit_id,weight_kg,height_cm,temperature_c,bp_systolic,bp_diastolic,pulse,spo2,respiratory_rate,notes)
  values(p_visit_id,p_weight_kg,p_height_cm,p_temperature_c,p_bp_systolic,p_bp_diastolic,p_pulse,p_spo2,p_respiratory_rate,p_notes)
  on conflict(visit_id) do update set weight_kg=excluded.weight_kg,height_cm=excluded.height_cm,temperature_c=excluded.temperature_c,bp_systolic=excluded.bp_systolic,bp_diastolic=excluded.bp_diastolic,pulse=excluded.pulse,spo2=excluded.spo2,respiratory_rate=excluded.respiratory_rate,notes=excluded.notes,recorded_by=auth.uid(),updated_at=now()
  returning id into v_id;
  update public.visits set status='ready' where id=p_visit_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'VITALS_RECORDED','visit',p_visit_id);
  return v_id;
end $$;

create function public.save_visit_consultation(
  p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text,
  p_follow_up_type public.follow_up_type, p_follow_up_date date, p_follow_up_days integer,
  p_medicines jsonb, p_tests jsonb, p_complete boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
  select doctor_id,patient_id into v_doctor,v_patient from public.visits where id=p_visit_id and status <> 'cancelled' for update;
  if not found or (v_role='doctor' and v_doctor<>public.current_doctor_id()) then raise exception 'visit unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.consultations where visit_id=p_visit_id and status='completed') then raise exception 'completed consultation is immutable'; end if;
  insert into public.consultations(visit_id,doctor_id,symptoms,history,examination,assessment,advice,follow_up_type,follow_up_date,follow_up_days,status,completed_at)
  values(p_visit_id,v_doctor,p_symptoms,p_history,p_examination,p_assessment,p_advice,p_follow_up_type,p_follow_up_date,p_follow_up_days,case when p_complete then 'completed'::public.consultation_status else 'draft'::public.consultation_status end,case when p_complete then now() end)
  on conflict(visit_id) do update set symptoms=excluded.symptoms,history=excluded.history,examination=excluded.examination,assessment=excluded.assessment,advice=excluded.advice,follow_up_type=excluded.follow_up_type,follow_up_date=excluded.follow_up_date,follow_up_days=excluded.follow_up_days,status=excluded.status,completed_at=excluded.completed_at
  returning id into v_consultation;
  insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'draft') on conflict(visit_id) do update set updated_at=now() returning id into v_prescription;
  delete from public.prescription_items where prescription_id=v_prescription;
  for v_line in select value from jsonb_array_elements(coalesce(p_medicines,'[]'::jsonb)) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;
  delete from public.test_orders where visit_id=p_visit_id and status in ('ordered','report_pending');
  for v_line in select value from jsonb_array_elements(coalesce(p_tests,'[]'::jsonb)) loop
    insert into public.test_orders(patient_id,visit_id,doctor_id,test_name,status,notes) values(v_patient,p_visit_id,v_doctor,v_line->>'test_name','ordered',v_line->>'notes');
  end loop;
  if p_complete then
    update public.prescriptions set status=case when jsonb_array_length(coalesce(p_medicines,'[]'::jsonb))>0 then 'pending'::public.prescription_status else 'cancelled'::public.prescription_status end where id=v_prescription;
    update public.visits set status='completed' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'CONSULTATION_COMPLETED','visit',p_visit_id);
  else
    update public.visits set status='in_consultation' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'CONSULTATION_DRAFT_SAVED','visit',p_visit_id);
  end if;
  return v_consultation;
end $$;

revoke all on function public.record_visit_vitals(uuid,numeric,numeric,numeric,smallint,smallint,smallint,smallint,smallint,text) from public;
revoke all on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean) from public;
grant execute on function public.record_visit_vitals(uuid,numeric,numeric,numeric,smallint,smallint,smallint,smallint,smallint,text) to authenticated;
grant execute on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean) to authenticated;

commit;
