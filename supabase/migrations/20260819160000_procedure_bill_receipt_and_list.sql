-- Two gaps on the Procedure Bills screen (Inventory > Procedure Bills):
--
-- 1. The bills list embedded patients(name,uhid) directly, but the pharmacy
--    role has no SELECT on public.patients for a patient linked only via a
--    procedure_sales.patient_id (clinical_roles_patients_read only scopes to
--    admin/reception/op/doctor/ip, and the pharmacy-scoped grant added in
--    20260819090000 is only for patients reachable through a visit -- a
--    walk-in dressing patient with no OP visit has neither). Same defect
--    list_pharmacy_sales (20260816120000) already fixed for the Sales
--    screen, never applied here: every pharmacist saw a blank Patient
--    column, admin didn't (RLS lets admin through), which read as
--    "sometimes broken."
--
-- 2. There was no way to reopen or print a bill after creation at all -- no
--    print route, no action column on the list. Adding
--    get_procedure_bill_receipt (same shape as get_sale_receipt) plus the
--    /print/procedure-bill/[id] route that uses it.
begin;

create or replace function public.list_procedure_sales(
  p_query text default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  sale_number integer,
  procedure_name text,
  procedure_fee_paise bigint,
  items_total_paise bigint,
  total_paise bigint,
  payment_mode text,
  ip_ticket_id uuid,
  created_at timestamptz,
  patient_name text,
  patient_uhid text,
  doctor_name text
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
    s.id, s.sale_number, s.procedure_name, s.procedure_fee_paise, s.items_total_paise,
    s.total_paise, s.payment_mode::text, s.ip_ticket_id, s.created_at,
    pt.name, pt.uhid, d.display_name
  from public.procedure_sales s
  left join public.patients pt on pt.id = s.patient_id
  left join public.doctors d on d.id = s.doctor_id
  where v_query is null
     or pt.name ilike '%'||v_query||'%'
     or pt.phone_normalized like '%'||regexp_replace(v_query,'\D','','g')||'%'
     or s.procedure_name ilike '%'||v_query||'%'
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

revoke all on function public.list_procedure_sales(text,integer) from public, anon;
grant execute on function public.list_procedure_sales(text,integer) to authenticated, service_role;

create or replace function public.get_procedure_bill_receipt(p_sale_id uuid)
returns table(
  sale_id uuid,
  sale_number integer,
  created_at timestamptz,
  procedure_name text,
  procedure_fee_paise bigint,
  items_total_paise bigint,
  total_paise bigint,
  payment_mode text,
  ip_ticket_id uuid,
  patient_name text,
  patient_phone text,
  patient_uhid text,
  doctor_name text,
  billed_by text,
  items jsonb
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() not in ('admin','pharmacy') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select
    s.id, s.sale_number, s.created_at, s.procedure_name, s.procedure_fee_paise,
    s.items_total_paise, s.total_paise, s.payment_mode::text, s.ip_ticket_id,
    pt.name, pt.phone_normalized, pt.uhid, d.display_name, pr.full_name,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', inv.name,
                  'quantity', si.quantity,
                  'unit_price_paise', si.unit_price_paise,
                  'amount_paise', si.quantity * si.unit_price_paise
                )
                order by inv.name)
       from public.procedure_sale_items si
       join public.inventory_items inv on inv.id = si.inventory_item_id
       where si.sale_id = s.id),
      '[]'::jsonb
    )
  from public.procedure_sales s
  left join public.patients pt on pt.id = s.patient_id
  left join public.doctors d on d.id = s.doctor_id
  left join public.profiles pr on pr.id = s.created_by
  where s.id = p_sale_id;
end $$;

revoke all on function public.get_procedure_bill_receipt(uuid) from public, anon;
grant execute on function public.get_procedure_bill_receipt(uuid) to authenticated, service_role;

commit;
