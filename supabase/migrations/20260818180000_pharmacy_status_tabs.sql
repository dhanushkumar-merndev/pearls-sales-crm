-- Pharmacy's "Pending Prescriptions" page had no way to look at what was
-- already dispensed, or browse everything -- list_pending_prescriptions
-- hard-filtered to pending/partially_dispensed. Adds an optional status
-- filter, defaulting to the existing behaviour so dashboard's pharmacy
-- activity feed (which never passes it) is unaffected.
begin;

create or replace function public.list_pending_prescriptions(
  p_query text default null,
  p_limit integer default 50,
  p_status_filter text default 'pending'
)
returns table(
  id uuid,
  prescription_number bigint,
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
declare v_query text; v_statuses public.prescription_status[];
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  v_statuses := case p_status_filter
    when 'completed' then array['dispensed']::public.prescription_status[]
    when 'all' then array['pending','partially_dispensed','dispensed','expired','cancelled']::public.prescription_status[]
    else array['pending','partially_dispensed']::public.prescription_status[]
  end;
  return query
  select
    p.id,
    p.prescription_number,
    p.status::text,
    p.created_at,
    (p.created_at + interval '24 hours'),
    p.visit_id,
    p.ip_ticket_id,
    v.token_number,
    case when p.ip_ticket_id is not null then 'IP' else 'OP' end,
    coalesce(vp.name, ip.name),
    coalesce(vp.phone_normalized, ip.phone_normalized),
    d.display_name,
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
                   'dose', i.dose,
                   'frequency', i.frequency,
                   'duration', i.duration,
                   'route', i.route,
                   'dosage_form', md.dosage_form,
                   'strength', md.strength,
                   'requested_quantity', i.requested_quantity,
                   'dispensed_quantity', i.dispensed_quantity
                 )
                 order by i.created_at
               )
        from public.prescription_items i
        left join public.medicine_directory md on md.id = i.medicine_id
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
  where p.status = any(v_statuses)
    and (
      v_query is null
      or coalesce(vp.name, ip.name) ilike '%'||v_query||'%'
      or coalesce(vp.phone_normalized, ip.phone_normalized) like v_query||'%'
      or v.token_number::text = v_query
      or p.prescription_number::text = regexp_replace(v_query,'\D','','g')
    )
  order by
    case when p_status_filter = 'pending' then v.token_number end nulls last,
    case when p_status_filter <> 'pending' then p.created_at end desc,
    p.created_at
  limit least(greatest(p_limit,1),200);
end $$;

revoke all on function public.list_pending_prescriptions(text,integer,text) from public;
grant execute on function public.list_pending_prescriptions(text,integer,text) to authenticated;

-- The two-argument version would otherwise stay callable via PostgREST
-- overload resolution and silently ignore the new filter.
drop function if exists public.list_pending_prescriptions(text, integer);

commit;
