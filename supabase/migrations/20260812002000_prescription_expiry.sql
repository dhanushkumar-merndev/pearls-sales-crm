-- Prescriptions remain actionable in the hospital pharmacy for 24 hours.
-- The prescription stays in the clinical record after expiry, but it cannot
-- create a pharmacy sale or change stock.
alter type public.prescription_status add value if not exists 'expired';

-- PostgreSQL requires a newly-added enum value to be committed before it can
-- be used by functions and statements later in the migration.
commit;
begin;

create index if not exists prescriptions_actionable_expiry_idx
  on public.prescriptions(created_at)
  where status in ('pending', 'partially_dispensed');

create or replace function public.expire_stale_prescriptions_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
begin
  update public.prescriptions
  set status = 'expired'::public.prescription_status
  where status in ('pending', 'partially_dispensed')
    and created_at <= now() - interval '24 hours';

  get diagnostics v_expired = row_count;

  if v_expired > 0 then
    insert into public.audit_logs(action, entity_type, metadata)
    values (
      'PRESCRIPTIONS_AUTO_EXPIRED',
      'prescription',
      jsonb_build_object(
        'count', v_expired,
        'expiry_hours', 24,
        'expired_at', now()
      )
    );
  end if;

  return v_expired;
end
$$;

revoke all on function public.expire_stale_prescriptions_internal() from public;

create or replace function public.expire_stale_prescriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.expire_stale_prescriptions_internal();
end
$$;

revoke all on function public.expire_stale_prescriptions() from public;
grant execute on function public.expire_stale_prescriptions() to authenticated;

create or replace function public.protect_prescription_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('dispensed', 'cancelled', 'expired')
     and new.status <> old.status then
    raise exception 'closed prescription is immutable';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'prescription cannot return to draft';
  end if;
  if public.current_app_role() = 'doctor'
     and old.status <> 'draft'
     and new.status <> old.status then
    raise exception 'completed prescription lifecycle is controlled by pharmacy';
  end if;
  return new;
end
$$;

create or replace function public.dispense_prescription(
  p_prescription_id uuid,
  p_lines jsonb,
  p_payment_mode public.payment_mode,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_sale_id uuid;
  v_patient_id uuid;
  v_ip_ticket_id uuid;
  v_source public.sale_source;
  v_line jsonb;
  v_item public.prescription_items%rowtype;
  v_batch public.medicine_batches%rowtype;
  v_qty integer;
  v_total bigint := 0;
  v_remaining integer;
begin
  v_role := public.current_app_role();
  if v_role not in ('admin', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_sale_id
  from public.pharmacy_sales
  where idempotency_key = p_idempotency_key;
  if v_sale_id is not null then
    return v_sale_id;
  end if;

  select
    v.patient_id,
    p.ip_ticket_id,
    case
      when p.ip_ticket_id is null then 'op'::public.sale_source
      else 'ip'::public.sale_source
    end
  into v_patient_id, v_ip_ticket_id, v_source
  from public.prescriptions p
  left join public.visits v on v.id = p.visit_id
  where p.id = p_prescription_id
    and p.status in ('pending', 'partially_dispensed')
    and p.created_at > now() - interval '24 hours'
  for update of p;

  if not found or v_patient_id is null then
    select i.patient_id, p.ip_ticket_id, 'ip'::public.sale_source
    into v_patient_id, v_ip_ticket_id, v_source
    from public.prescriptions p
    join public.ip_tickets i on i.id = p.ip_ticket_id
    where p.id = p_prescription_id
      and p.status in ('pending', 'partially_dispensed')
      and p.created_at > now() - interval '24 hours'
    for update of p;
  end if;

  if v_patient_id is null then
    raise exception 'prescription expired or unavailable';
  end if;

  insert into public.pharmacy_sales(
    prescription_id,
    patient_id,
    source,
    ip_ticket_id,
    payment_mode,
    idempotency_key
  ) values (
    p_prescription_id,
    v_patient_id,
    v_source,
    v_ip_ticket_id,
    p_payment_mode,
    p_idempotency_key
  ) returning id into v_sale_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty <= 0 then
      raise exception 'invalid quantity';
    end if;

    select * into v_item
    from public.prescription_items
    where id = (v_line ->> 'prescription_item_id')::uuid
      and prescription_id = p_prescription_id
    for update;
    if not found or v_item.dispensed_quantity + v_qty > v_item.requested_quantity then
      raise exception 'quantity exceeds pending prescription';
    end if;

    select * into v_batch
    from public.medicine_batches
    where id = (v_line ->> 'batch_id')::uuid
      and medicine_id = v_item.medicine_id
      and active
    for update;
    if not found
       or v_batch.quantity < v_qty
       or v_batch.expiry_date < current_date then
      raise exception 'batch stock unavailable';
    end if;

    update public.medicine_batches
    set quantity = quantity - v_qty,
        updated_at = now()
    where id = v_batch.id;

    update public.prescription_items
    set dispensed_quantity = dispensed_quantity + v_qty
    where id = v_item.id;

    insert into public.pharmacy_sale_items(
      sale_id,
      prescription_item_id,
      batch_id,
      quantity,
      unit_price_paise
    ) values (
      v_sale_id,
      v_item.id,
      v_batch.id,
      v_qty,
      v_batch.selling_price_paise
    );

    v_total := v_total + v_qty * v_batch.selling_price_paise;
  end loop;

  update public.pharmacy_sales
  set total_paise = v_total
  where id = v_sale_id;

  select count(*) into v_remaining
  from public.prescription_items
  where prescription_id = p_prescription_id
    and dispensed_quantity < requested_quantity;

  update public.prescriptions
  set status = case
    when v_remaining = 0 then 'dispensed'::public.prescription_status
    else 'partially_dispensed'::public.prescription_status
  end
  where id = p_prescription_id;

  if v_source = 'ip' then
    insert into public.ip_charges(
      ip_ticket_id,
      category,
      item,
      quantity,
      rate_paise,
      source_type,
      source_id,
      idempotency_key
    ) values (
      v_ip_ticket_id,
      'pharmacy',
      'Pharmacy medicines',
      1,
      v_total,
      'pharmacy_sale',
      v_sale_id,
      p_idempotency_key
    );
  end if;

  insert into public.audit_logs(
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    auth.uid(),
    'PHARMACY_DISPENSED',
    'pharmacy_sale',
    v_sale_id,
    jsonb_build_object(
      'amount_paise', v_total,
      'prescription_status', case when v_remaining = 0 then 'completed' else 'partially_dispensed' end
    )
  );

  return v_sale_id;
end
$$;

revoke all on function public.dispense_prescription(
  uuid,
  jsonb,
  public.payment_mode,
  uuid
) from public;
grant execute on function public.dispense_prescription(
  uuid,
  jsonb,
  public.payment_mode,
  uuid
) to authenticated;

create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'expire-stale-hospital-prescriptions';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'expire-stale-hospital-prescriptions',
    '* * * * *',
    'select public.expire_stale_prescriptions_internal()'
  );
end
$$;

select public.expire_stale_prescriptions_internal();

commit;
