-- Structured diagnosis entries: consultations.assessment has always been a
-- single free-text blob (diagnoses joined with newlines), which is enough
-- for printing but cannot carry which coding system a diagnosis came from
-- (ICD-10 / SNOMED-CT / uncoded "Other"), or a Provisional/Confirmed status,
-- or a note specific to that one diagnosis -- all of which the redesigned
-- Assessment/Diagnosis box now needs (tabs per code system, a status
-- dropdown, per-diagnosis notes).
--
-- Additive, not a replacement: consultations.assessment keeps being written
-- exactly as before (still the joined display text of every diagnosis on the
-- consultation), so print_prescription, exports, dashboards and every other
-- existing reader of that column is untouched. consultation_diagnoses is
-- purely what the new picker UI reads back to reconstruct its richer state
-- when a draft is reopened.
begin;

create type public.diagnosis_status as enum ('provisional','confirmed');

create table public.consultation_diagnoses (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  -- Set when the diagnosis was picked from the directory; null for a typed
  -- "Other Diagnosis" entry that matched nothing. Not itself load-bearing --
  -- code/code_system/display_text are copied at save time so this row still
  -- reads correctly even if the directory term is later edited or removed.
  term_id uuid references public.clinical_terms(id) on delete set null,
  display_text text not null check (length(trim(display_text)) >= 1),
  code text,
  code_system text,
  status public.diagnosis_status not null default 'provisional',
  notes text,
  created_at timestamptz not null default now()
);

create index consultation_diagnoses_consultation_idx on public.consultation_diagnoses(consultation_id);

alter table public.consultation_diagnoses enable row level security;

-- Same visibility as the parent consultation: admin/doctor/op/ip/reception
-- read any consultation's diagnoses (consultations_read is already this
-- blanket -- see 20260815200000), pharmacy only the visits it has actual
-- business with (pharmacy_may_view_visit, added in 20260819090000). Writes
-- only ever happen through save_visit_consultation below (security definer,
-- bypasses RLS as its owner) -- no insert/update/delete policy is needed or
-- granted here.
create policy consultation_diagnoses_read on public.consultation_diagnoses for select to authenticated
  using(
    exists(
      select 1 from public.consultations c
      where c.id = consultation_diagnoses.consultation_id
        and (
          public.current_app_role() in ('admin','doctor','op','ip','reception')
          or (public.current_app_role()='pharmacy' and public.pharmacy_may_view_visit(c.visit_id))
        )
    )
  );

-- save_visit_consultation gains one trailing param, p_diagnoses. Per the
-- lesson in 20260818230000 (CREATE OR REPLACE cannot fold a signature
-- change, it silently adds a second overload), the exact current 16-arg
-- signature is dropped first so only the 17-arg version exists afterwards.
drop function if exists public.save_visit_consultation(
  uuid, text, text, text, text, text, public.follow_up_type, date, integer,
  jsonb, jsonb, boolean, bigint, boolean, text, text
);

create or replace function public.save_visit_consultation(
  p_visit_id uuid, p_symptoms text, p_history text, p_examination text, p_assessment text, p_advice text,
  p_follow_up_type public.follow_up_type, p_follow_up_date date, p_follow_up_days integer,
  p_medicines jsonb, p_tests jsonb, p_complete boolean, p_fee_paise bigint default null,
  p_admission_recommended boolean default false, p_admission_ward_type text default null,
  p_admission_reason text default null, p_diagnoses jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_doctor uuid; v_patient uuid; v_consultation uuid; v_prescription uuid; v_line jsonb;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin','doctor','pharmacy') then raise exception 'forbidden' using errcode='42501'; end if;
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

  delete from public.consultation_diagnoses where consultation_id=v_consultation;
  for v_line in select value from jsonb_array_elements(coalesce(p_diagnoses,'[]'::jsonb)) loop
    insert into public.consultation_diagnoses(consultation_id,term_id,display_text,code,code_system,status,notes)
    values(
      v_consultation,
      nullif(v_line->>'term_id','')::uuid,
      v_line->>'display_text',
      nullif(v_line->>'code',''),
      nullif(v_line->>'code_system',''),
      coalesce(nullif(v_line->>'status','')::public.diagnosis_status,'provisional'),
      nullif(v_line->>'notes','')
    );
  end loop;

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
end $$;

revoke all on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean,bigint,boolean,text,text,jsonb) from public;
grant execute on function public.save_visit_consultation(uuid,text,text,text,text,text,public.follow_up_type,date,integer,jsonb,jsonb,boolean,bigint,boolean,text,text,jsonb) to authenticated;

commit;
