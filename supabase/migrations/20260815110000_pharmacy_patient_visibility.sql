-- Pharmacy could not resolve patient names on the pending-prescription queue:
-- clinical_roles_patients_read grants SELECT on public.patients to
-- admin/reception/op/doctor/ip only, so the embedded patient join returned NULL
-- and every row rendered as an em dash.
--
-- Widening the patients policy to 'pharmacy' would also expose allergies,
-- address, notes and DOB, which AGENTS.md 46 explicitly keeps out of the
-- pharmacy role. Instead expose exactly the identifying columns the dispensing
-- queue needs through a security-definer RPC, matching the column-security
-- pattern already used by search_medicine_availability and list_pharmacy_batches.
--
-- The RPC also returns the OP token number so the queue can be ordered by token
-- rather than by prescription number.
begin;

create or replace function public.list_pending_prescriptions(
  p_query text default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  prescription_number integer,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  visit_id uuid,
  ip_ticket_id uuid,
  token_number integer,
  source text,
  patient_name text,
  patient_phone text,
  doctor_name text,
  consultation_fee_paise bigint,
  consultation_balance_paise bigint,
  items jsonb
)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  select
    p.id,
    p.prescription_number,
    p.status::text,
    p.created_at,
    -- Expiry is derived, not stored: expire_stale_prescriptions() voids anything
    -- still pending 24h after the doctor issued it.
    (p.created_at + interval '24 hours'),
    p.visit_id,
    p.ip_ticket_id,
    v.token_number,
    case when p.ip_ticket_id is not null then 'IP' else 'OP' end,
    coalesce(vp.name, ip.name),
    coalesce(vp.phone_normalized, ip.phone_normalized),
    d.display_name,
    -- The consulting doctor set this fee; the pharmacy counter collects it.
    coalesce(v.fee_paise,0)::bigint,
    greatest(
      0,
      coalesce(v.fee_paise,0) - coalesce(
        (select sum(vp.amount_paise) from public.visit_payments vp where vp.visit_id = v.id),
        0
      )
    )::bigint,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', i.id,
                   'medicine_id', i.medicine_id,
                   'medicine_name', i.medicine_name,
                   'requested_quantity', i.requested_quantity,
                   'dispensed_quantity', i.dispensed_quantity
                 )
                 order by i.created_at
               )
        from public.prescription_items i
        where i.prescription_id = p.id
      ),
      '[]'::jsonb
    )
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  left join public.patients vp on vp.id = v.patient_id
  left join public.ip_tickets t on t.id = p.ip_ticket_id
  left join public.patients ip on ip.id = t.patient_id
  left join public.doctors d on d.id = p.doctor_id
  where p.status in ('pending','partially_dispensed')
    and (
      v_query is null
      or coalesce(vp.name, ip.name) ilike '%'||v_query||'%'
      or coalesce(vp.phone_normalized, ip.phone_normalized) like v_query||'%'
      or v.token_number::text = v_query
      or p.prescription_number::text = regexp_replace(v_query,'\D','','g')
    )
  order by v.token_number nulls last, p.created_at
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_pending_prescriptions(text,integer) from public;
grant execute on function public.list_pending_prescriptions(text,integer) to authenticated;

commit;
