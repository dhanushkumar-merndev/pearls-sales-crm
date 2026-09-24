-- Manual IP billing must come from the active Charges master. Automated
-- charges (doctor rounds, pharmacy, procedures and ward inventory) continue
-- to be created by their existing security-definer workflows.

drop policy if exists ip_charges_write on public.ip_charges;

create or replace function public.add_configured_ip_charge(
  p_ticket_id uuid,
  p_charge_id uuid,
  p_quantity integer,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.app_role;
  v_category public.charge_category;
  v_charge_name text;
  v_rate_paise bigint;
  v_charge_row_id uuid;
  v_existing_ticket_id uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select charge.id, charge.ip_ticket_id
  into v_charge_row_id, v_existing_ticket_id
  from public.ip_charges charge
  where charge.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_ticket_id is distinct from p_ticket_id then
      raise exception 'idempotency key belongs to another ticket';
    end if;
    return v_charge_row_id;
  end if;

  perform 1
  from public.ip_tickets ticket
  where ticket.id = p_ticket_id
    and ticket.status in ('admitted', 'discharge_pending')
  for update;
  if not found then
    raise exception 'IP ticket is not open';
  end if;

  select
    case charge.category
      when 'IP Doctor' then 'doctor'::public.charge_category
      when 'Ward' then 'ward'::public.charge_category
      when 'Room' then 'room'::public.charge_category
      when 'Bed' then 'bed'::public.charge_category
      when 'Treatment' then 'treatment'::public.charge_category
      when 'Test' then 'test'::public.charge_category
      when 'Other' then 'other'::public.charge_category
    end,
    charge.charge_name,
    charge.amount_paise
  into v_category, v_charge_name, v_rate_paise
  from public.charges charge
  where charge.id = p_charge_id
    and charge.active;
  if not found or v_category is null then
    raise exception 'configured charge is no longer active';
  end if;

  insert into public.ip_charges(
    ip_ticket_id,
    category,
    item,
    quantity,
    rate_paise,
    idempotency_key
  ) values (
    p_ticket_id,
    v_category,
    v_charge_name,
    p_quantity,
    v_rate_paise,
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_charge_row_id;

  if v_charge_row_id is null then
    select charge.id, charge.ip_ticket_id
    into v_charge_row_id, v_existing_ticket_id
    from public.ip_charges charge
    where charge.idempotency_key = p_idempotency_key;
    if v_existing_ticket_id is distinct from p_ticket_id then
      raise exception 'idempotency key belongs to another ticket';
    end if;
  end if;

  return v_charge_row_id;
end $function$;

revoke all on function public.add_configured_ip_charge(uuid, uuid, integer, uuid) from public;
grant execute on function public.add_configured_ip_charge(uuid, uuid, integer, uuid) to authenticated;

comment on function public.add_configured_ip_charge(uuid, uuid, integer, uuid) is
  'Adds an IP charge from the active Charges master; arbitrary manual descriptions and rates are rejected.';
