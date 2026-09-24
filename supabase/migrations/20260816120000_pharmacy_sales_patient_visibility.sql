-- The pharmacy Sales screen embedded patients(name, phone_normalized), but the
-- pharmacy role has no SELECT on public.patients (clinical_roles_patients_read
-- covers admin/reception/op/doctor/ip only). Admin saw the patient column;
-- every pharmacist saw it blank -- the same defect that list_pending_prescriptions
-- was created to fix, still present on the sales history.
--
-- Same remedy: expose exactly the identifying columns through a definer RPC
-- instead of widening the patients policy, which would also hand the pharmacy
-- allergies, address, DOB and notes (AGENTS.md 46).
begin;

create or replace function public.list_pharmacy_sales(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  created_at timestamptz,
  source text,
  total_paise bigint,
  patient_name text,
  patient_phone text,
  dispensed_by text,
  item_count bigint,
  total_count bigint
)
language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role; v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(coalesce(p_query,'')),'');
  return query
  with matched as (
    select s.id, s.created_at, s.source::text as source, s.total_paise,
           pt.name as patient_name, pt.phone_normalized as patient_phone,
           pr.full_name as dispensed_by,
           (select count(*) from public.pharmacy_sale_items i where i.sale_id = s.id) as item_count
    from public.pharmacy_sales s
    left join public.patients pt on pt.id = s.patient_id
    left join public.profiles pr on pr.id = s.dispensed_by
    where v_query is null
       or pt.name ilike '%'||v_query||'%'
       or pt.phone_normalized like '%'||regexp_replace(v_query,'\D','','g')||'%'
  )
  select m.id, m.created_at, m.source, m.total_paise, m.patient_name, m.patient_phone,
         m.dispensed_by, m.item_count, count(*) over () as total_count
  from matched m
  order by m.created_at desc
  limit least(greatest(p_limit,1),200)
  offset greatest(p_offset,0);
end $$;

revoke all on function public.list_pharmacy_sales(text,integer,integer) from public, anon;
grant execute on function public.list_pharmacy_sales(text,integer,integer) to authenticated, service_role;

commit;
