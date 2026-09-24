-- A dispense can be partial: the counter has 4 of the 10 tablets prescribed,
-- or none at all. The hospital bills only what it handed over, so the receipt
-- was silent about the rest and the family left without knowing what they
-- still had to buy. The receipt now carries the unsupplied lines, and the
-- prescription id so the counter can print a slip for buying them outside.
drop function if exists get_sale_receipt(uuid);

create function get_sale_receipt(p_sale_id uuid)
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
  prescription_id uuid,
  prescription_number bigint,
  doctor_name text,
  medicines_paise bigint,
  consultation_paise bigint,
  items jsonb,
  unsupplied jsonb
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin','pharmacy','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select
    s.id, s.created_at, s.source::text, s.payment_mode::text, pr.full_name,
    pt.name, pt.phone_normalized, pt.uhid, v.id, v.token_number,
    rx.id, rx.prescription_number, d.display_name,
    coalesce(s.total_paise,0)::bigint,
    coalesce((select sum(vp.amount_paise) from public.visit_payments vp
              where vp.idempotency_key = s.idempotency_key),0)::bigint,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', i.medicine_name,
                  'batch', b.batch_number,
                  'quantity', si.quantity,
                  'units_per_pack', coalesce(b.units_per_pack,1),
                  'unit_price_paise', si.unit_price_paise,
                  'amount_paise', si.amount_paise
                )
                order by i.medicine_name)
       from public.pharmacy_sale_items si
       join public.prescription_items i on i.id = si.prescription_item_id
       left join public.medicine_batches b on b.id = si.batch_id
       where si.sale_id = s.id),
      '[]'::jsonb
    ),
    -- What this prescription still owes the patient: a line never dispensed
    -- at all, and the unmet balance of a partly dispensed one.
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'name', i.medicine_name,
                  'dose', i.dose,
                  'frequency', i.frequency,
                  'duration', i.duration,
                  'pending', i.requested_quantity - coalesce(i.dispensed_quantity,0)
                )
                order by i.medicine_name)
       from public.prescription_items i
       where i.prescription_id = s.prescription_id
         and i.requested_quantity - coalesce(i.dispensed_quantity,0) > 0),
      '[]'::jsonb
    )
  from public.pharmacy_sales s
  left join public.profiles pr on pr.id = s.dispensed_by
  left join public.patients pt on pt.id = s.patient_id
  left join public.prescriptions rx on rx.id = s.prescription_id
  left join public.visits v on v.id = rx.visit_id
  left join public.doctors d on d.id = rx.doctor_id
  where s.id = p_sale_id;
end $function$;

grant execute on function get_sale_receipt(uuid) to authenticated;
