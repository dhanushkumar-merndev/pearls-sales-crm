-- Four related gaps that all surfaced during real counter use:
--
--   1. Allergies could only be edited by reception/admin. The doctor is the one
--      who discovers an allergy during the consultation, and had no way to
--      record it on the patient.
--   2. OP staff could not see whether a patient still owes the consultation
--      fee, so they could not tell them to go to the billing counter.
--   3. A diagnosis or investigation typed as free text vanished after the
--      visit: the next doctor had to type it again from scratch.
--   4. A completed pharmacy sale had no printable receipt, so the counter could
--      not hand the patient proof of what they paid for.
begin;

-- 1. Allergies -----------------------------------------------------------
-- Deliberately narrow: this writes the allergies column and nothing else, so
-- clinical roles can record an allergy without gaining edit rights over the
-- rest of the patient record.
create or replace function public.update_patient_allergies(
  p_patient_id uuid,
  p_allergies text
)
returns text
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_value text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor','reception','ip','op') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(coalesce(p_allergies,'')) > 1000 then
    raise exception 'allergies too long' using errcode='22001';
  end if;

  v_value := nullif(btrim(coalesce(p_allergies,'')),'');
  update public.patients set allergies = v_value, updated_at = now()
  where id = p_patient_id;
  if not found then
    raise exception 'patient not found' using errcode='42704';
  end if;

  -- The value itself is clinical content and stays out of the log; only the
  -- fact that it changed is recorded.
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'PATIENT_UPDATED', 'patient', p_patient_id,
          jsonb_build_object('field','allergies','cleared', v_value is null));
  return coalesce(v_value,'');
end $$;

revoke all on function public.update_patient_allergies(uuid,text) from public, anon;
grant execute on function public.update_patient_allergies(uuid,text) to authenticated, service_role;

-- 2. Balance visible to the OP desk --------------------------------------
-- OP staff route the patient after the consultation: to the pharmacy when
-- medicines were prescribed, to billing when only the fee is outstanding. They
-- need the balance to do that. This RPC returns the fee, what has been
-- collected and nothing else -- it is not hospital revenue analytics, which
-- remain admin-only.
create or replace function public.get_visit_financial_summaries(p_visit_ids uuid[])
returns table(visit_id uuid, fee_paise bigint, collected_paise bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','reception','op') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select v.id, v.fee_paise, coalesce(sum(p.amount_paise),0)::bigint
  from public.visits v
  left join public.visit_payments p on p.visit_id = v.id
  where v.id = any(p_visit_ids)
  group by v.id;
end $$;

revoke all on function public.get_visit_financial_summaries(uuid[]) from public, anon;
grant execute on function public.get_visit_financial_summaries(uuid[]) to authenticated, service_role;

-- 3. Free-typed clinical terms are kept ----------------------------------
-- A doctor who types a diagnosis the directory does not have is telling us the
-- directory is incomplete. Storing it makes it searchable for everyone next
-- time, which is how the local directory is meant to grow (AGENTS.md 20/21).
-- Coded entries imported from ICD-10 are never overwritten by this.
create or replace function public.add_clinical_term(
  p_term_type text,
  p_display_text text
)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_text text;
  v_id uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_term_type not in ('symptom','diagnosis','investigation','advice') then
    raise exception 'unknown term type' using errcode='22023';
  end if;

  v_text := btrim(coalesce(p_display_text,''));
  if length(v_text) < 2 or length(v_text) > 300 then
    raise exception 'invalid term' using errcode='22023';
  end if;

  select id into v_id from public.clinical_terms
  where term_type = p_term_type and normalized_text = lower(v_text);
  if v_id is not null then
    return v_id;
  end if;

  insert into public.clinical_terms(term_type, display_text, source, source_version)
  values (p_term_type, v_text, 'hospital', 'entered-during-consultation')
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.add_clinical_term(text,text) from public, anon;
grant execute on function public.add_clinical_term(text,text) to authenticated, service_role;

-- 4. Printable sale receipt ----------------------------------------------
-- One dispense can carry two different charges: the medicines, and the
-- consultation fee the doctor set which the counter collects at the same time.
-- The consultation payment is written with the same idempotency key as the
-- sale, which is what ties the two halves of the receipt together.
create or replace function public.get_sale_receipt(p_sale_id uuid)
returns table(
  sale_id uuid,
  created_at timestamptz,
  source text,
  payment_mode text,
  dispensed_by text,
  patient_name text,
  patient_phone text,
  patient_uhid text,
  visit_id uuid,
  token_number integer,
  prescription_number bigint,
  doctor_name text,
  medicines_paise bigint,
  consultation_paise bigint,
  items jsonb
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','pharmacy','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select
    s.id,
    s.created_at,
    s.source::text,
    s.payment_mode::text,
    pr.full_name,
    pt.name,
    pt.phone_normalized,
    pt.uhid,
    v.id,
    v.token_number,
    rx.prescription_number,
    d.display_name,
    coalesce(s.total_paise,0)::bigint,
    coalesce(
      (select sum(vp.amount_paise)
       from public.visit_payments vp
       where vp.idempotency_key = s.idempotency_key),
      0
    )::bigint,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', i.medicine_name,
                  'batch', b.batch_number,
                  'quantity', si.quantity,
                  'unit_price_paise', si.unit_price_paise,
                  'amount_paise', si.quantity * si.unit_price_paise
                )
                order by i.medicine_name)
       from public.pharmacy_sale_items si
       join public.prescription_items i on i.id = si.prescription_item_id
       left join public.medicine_batches b on b.id = si.batch_id
       where si.sale_id = s.id),
      '[]'::jsonb
    )
  from public.pharmacy_sales s
  left join public.profiles pr on pr.id = s.dispensed_by
  left join public.patients pt on pt.id = s.patient_id
  left join public.prescriptions rx on rx.id = s.prescription_id
  left join public.visits v on v.id = rx.visit_id
  left join public.doctors d on d.id = rx.doctor_id
  where s.id = p_sale_id;
end $$;

revoke all on function public.get_sale_receipt(uuid) from public, anon;
grant execute on function public.get_sale_receipt(uuid) to authenticated, service_role;

commit;
