-- The doctor now says WHAT KIND of investigation they are ordering -- lab,
-- X-ray, scan -- not just its name. The desk that arranges the test and the
-- staff who upload the result both need that: 'CT brain' and 'CBC' go to
-- completely different places in the hospital.
--
-- The category values are the report categories the hospital already
-- configures (Admin -> Masters), so an uploaded report lines up with the order
-- that asked for it.
begin;

alter table public.test_orders add column if not exists category text;

comment on column public.test_orders.category is
  'Report category the doctor expects back (Lab Report, Scan, X-Ray / Radiology, ...). Free text: the list is hospital-configurable.';

CREATE OR REPLACE FUNCTION public.save_visit_consultation(p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text, p_follow_up_type follow_up_type, p_follow_up_date date, p_follow_up_days integer, p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint DEFAULT NULL::bigint, p_admission_recommended boolean DEFAULT false, p_admission_ward_type text DEFAULT NULL::text, p_admission_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_complete and p_fee_paise is null then
    raise exception 'consultation fee required' using errcode='23514';
  end if;
  if p_fee_paise is not null and p_fee_paise < 0 then
    raise exception 'consultation fee must not be negative' using errcode='23514';
  end if;
  if p_admission_recommended and coalesce(p_admission_ward_type,'') not in ('general','private','icu') then
    raise exception 'ward type required' using errcode='23514';
  end if;
  select doctor_id,patient_id into v_doctor,v_patient from public.visits where id=p_visit_id and status <> 'cancelled' for update;
  if not found or (v_role='doctor' and v_doctor<>public.current_doctor_id()) then raise exception 'visit unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.consultations where visit_id=p_visit_id and status='completed') then raise exception 'completed consultation is immutable'; end if;
  insert into public.consultations(visit_id,doctor_id,symptoms,history,examination,assessment,advice,follow_up_type,follow_up_date,follow_up_days,status,completed_at,admission_recommended,admission_ward_type,admission_reason)
  values(p_visit_id,v_doctor,p_symptoms,p_history,p_examination,p_assessment,p_advice,p_follow_up_type,p_follow_up_date,p_follow_up_days,case when p_complete then 'completed'::public.consultation_status else 'draft'::public.consultation_status end,case when p_complete then now() end,coalesce(p_admission_recommended,false),case when p_admission_recommended then p_admission_ward_type end,case when p_admission_recommended then p_admission_reason end)
  on conflict(visit_id) do update set symptoms=excluded.symptoms,history=excluded.history,examination=excluded.examination,assessment=excluded.assessment,advice=excluded.advice,follow_up_type=excluded.follow_up_type,follow_up_date=excluded.follow_up_date,follow_up_days=excluded.follow_up_days,status=excluded.status,completed_at=excluded.completed_at,admission_recommended=excluded.admission_recommended,admission_ward_type=excluded.admission_ward_type,admission_reason=excluded.admission_reason
  returning id into v_consultation;
  insert into public.prescriptions(visit_id,doctor_id,status) values(p_visit_id,v_doctor,'draft') on conflict(visit_id) do update set updated_at=now() returning id into v_prescription;
  delete from public.prescription_items where prescription_id=v_prescription;
  for v_line in select value from jsonb_array_elements(coalesce(p_medicines,'[]'::jsonb)) loop
    insert into public.prescription_items(prescription_id,medicine_id,medicine_name,dose,frequency,duration,route,notes,requested_quantity)
    values(v_prescription,nullif(v_line->>'medicine_id','')::uuid,v_line->>'medicine_name',v_line->>'dose',v_line->>'frequency',v_line->>'duration',v_line->>'route',v_line->>'notes',greatest(1,coalesce((v_line->>'quantity')::integer,1)));
  end loop;
  delete from public.test_orders where visit_id=p_visit_id and status in ('ordered','report_pending');
  for v_line in select value from jsonb_array_elements(coalesce(p_tests,'[]'::jsonb)) loop
    insert into public.test_orders(patient_id,visit_id,doctor_id,test_name,category,status,notes) values(v_patient,p_visit_id,v_doctor,v_line->>'test_name',nullif(trim(coalesce(v_line->>'category','')),''),'ordered',v_line->>'notes');
  end loop;
  if p_fee_paise is not null then
    update public.visits set fee_paise=p_fee_paise where id=p_visit_id;
  end if;
  if p_complete then
    update public.prescriptions set status=case when jsonb_array_length(coalesce(p_medicines,'[]'::jsonb))>0 then 'pending'::public.prescription_status else 'cancelled'::public.prescription_status end where id=v_prescription;
    update public.visits set status='completed' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'CONSULTATION_COMPLETED','visit',p_visit_id,jsonb_build_object('fee_paise',p_fee_paise,'admission_recommended',coalesce(p_admission_recommended,false)));
  else
    update public.visits set status='in_consultation' where id=p_visit_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'CONSULTATION_DRAFT_SAVED','visit',p_visit_id);
  end if;
  return v_consultation;
end $function$
;

commit;
