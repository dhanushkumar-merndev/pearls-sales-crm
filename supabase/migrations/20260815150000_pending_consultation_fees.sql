-- The OP assistant walks a consulted patient to the counter, but no screen
-- showed who still owes money: /reception/payments lists payments already
-- collected, never outstanding balances.
--
-- This matters most for consultations with NO medicines. Those produce no
-- pharmacy prescription, so they never appear in the pharmacy queue, and their
-- consultation fee had no collection point anywhere in the app.
--
-- Needs an RPC because visits.fee_paise is column-revoked from authenticated
-- and visit_payments is readable only by admin/reception.
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
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
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
         -- Flags the case the pharmacy queue can never surface on its own.
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
      or lower(p.name) like '%'||v_query||'%'
      or p.phone_normalized like v_query||'%'
      or v.token_number::text = v_query
    )
  order by v.visit_date desc, v.token_number
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_pending_consultation_fees(text,integer,integer) from public;
grant execute on function public.list_pending_consultation_fees(text,integer,integer) to authenticated;

commit;
