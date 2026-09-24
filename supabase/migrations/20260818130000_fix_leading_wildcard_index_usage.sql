-- Query optimization pass: `lower(column) like '%text%'` cannot use any index
-- on `column` (functional wrapping) nor the trigram GIN index built on the
-- raw column, so every one of these predicates forced a sequential scan of
-- `patients` / `ip_tickets` on every keystroke of a debounced search. The
-- fix is `column ilike '%text%'`, which pg_trgm's GIN opclass supports
-- directly (case-insensitive, no function wrapper) -- the same idiom already
-- used correctly elsewhere in this codebase (see production_query_hardening).
--
-- Affects: the reception "pending consultation fees" queue (list_pending_
-- consultation_fees, live since 20260815150000) and the two pharmacy patient
-- pickers added for "Dispense as Per Rx" (added this session, 20260818110000).
begin;

create or replace function public.list_pending_consultation_fees(
  p_query text default null,
  p_days integer default 7,
  p_limit integer default 100
)
returns table(
  visit_id uuid,
  patient_id uuid,
  token_number integer,
  visit_date date,
  patient_name text,
  patient_phone text,
  doctor_name text,
  fee_paise bigint,
  collected_paise bigint,
  balance_paise bigint,
  has_prescription boolean
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','reception','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select v.id,
         v.patient_id,
         v.token_number,
         v.visit_date,
         p.name,
         p.phone_normalized,
         d.display_name,
         v.fee_paise,
         coalesce(paid.total,0)::bigint,
         (v.fee_paise - coalesce(paid.total,0))::bigint,
         exists(
           select 1 from public.prescriptions rx
           where rx.visit_id = v.id
             and rx.status in ('pending','partially_dispensed','dispensed')
         )
  from public.visits v
  join public.patients p on p.id = v.patient_id
  join public.doctors d on d.id = v.doctor_id
  left join lateral (
    select sum(vp.amount_paise) as total
    from public.visit_payments vp
    where vp.visit_id = v.id
  ) paid on true
  where v.status = 'completed'
    and v.fee_paise > coalesce(paid.total,0)
    and v.visit_date >= ((now() at time zone 'Asia/Kolkata')::date - greatest(p_days,0))
    and (
      v_query is null
      or p.name ilike '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
    )
  order by v.visit_date desc, v.token_number
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_pending_consultation_fees(text,integer,integer) from public;
grant execute on function public.list_pending_consultation_fees(text,integer,integer) to authenticated;

create or replace function public.list_today_op_visits_for_pharmacy(p_query text default null, p_limit integer default 50)
returns table(
  visit_id uuid, patient_id uuid, patient_name text, patient_phone text, patient_uhid text,
  token_number integer, status text, doctor_name text, fee_paise bigint, has_digital_consultation boolean
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text; v_uhid_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  v_uhid_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select v.id, p.id, p.name, p.phone_normalized, p.uhid, v.token_number, v.status::text, d.display_name, v.fee_paise,
    exists(select 1 from public.consultations c where c.visit_id=v.id and c.status='completed')
  from public.visits v
  join public.patients p on p.id=v.patient_id
  join public.doctors d on d.id=v.doctor_id
  where v.visit_date = current_date
    and v.status <> 'cancelled'
    and (
      v_query is null
      or p.name ilike '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
      or lower(p.uhid) like v_uhid_query||'%'
    )
  order by v.token_number
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_today_op_visits_for_pharmacy(text,integer) from public, anon;
grant execute on function public.list_today_op_visits_for_pharmacy(text,integer) to authenticated, service_role;

create or replace function public.list_admitted_ip_tickets_for_pharmacy(p_query text default null, p_limit integer default 50)
returns table(
  ip_ticket_id uuid, patient_id uuid, patient_name text, patient_phone text, patient_uhid text,
  ticket_number text, status text, doctor_name text, room text, bed text
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text; v_uhid_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  v_uhid_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select t.id, p.id, p.name, p.phone_normalized, p.uhid, t.ticket_number, t.status::text, d.display_name, t.room, t.bed
  from public.ip_tickets t
  join public.patients p on p.id=t.patient_id
  join public.doctors d on d.id=t.doctor_id
  where t.status in ('admitted','discharge_pending')
    and (
      v_query is null
      or p.name ilike '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or t.ticket_number ilike '%'||v_query||'%'
      or lower(p.uhid) like v_uhid_query||'%'
    )
  order by t.admission_at desc
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_admitted_ip_tickets_for_pharmacy(text,integer) from public, anon;
grant execute on function public.list_admitted_ip_tickets_for_pharmacy(text,integer) to authenticated, service_role;

commit;
