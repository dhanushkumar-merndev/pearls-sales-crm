begin;

create function public.add_custom_ip_charge(
  p_ticket_id uuid,
  p_item text,
  p_quantity integer,
  p_rate_paise bigint,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role;
  v_charge_row_id uuid;
  v_existing_ticket_id uuid;
  v_existing_item text;
  v_existing_quantity integer;
  v_existing_rate_paise bigint;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_item is null
    or char_length(btrim(p_item)) = 0
    or char_length(btrim(p_item)) > 200
  then
    raise exception 'custom charge item is invalid';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_rate_paise is null or p_rate_paise <= 0 then
    raise exception 'custom charge fee must be positive';
  end if;

  select
    charge.id,
    charge.ip_ticket_id,
    charge.item,
    charge.quantity,
    charge.rate_paise
  into
    v_charge_row_id,
    v_existing_ticket_id,
    v_existing_item,
    v_existing_quantity,
    v_existing_rate_paise
  from public.ip_charges charge
  where charge.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_ticket_id is distinct from p_ticket_id
      or v_existing_item is distinct from btrim(p_item)
      or v_existing_quantity is distinct from p_quantity
      or v_existing_rate_paise is distinct from p_rate_paise
    then
      raise exception 'idempotency key was reused with different charge details';
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

  insert into public.ip_charges(
    ip_ticket_id,
    category,
    item,
    quantity,
    rate_paise,
    idempotency_key
  ) values (
    p_ticket_id,
    'other',
    btrim(p_item),
    p_quantity,
    p_rate_paise,
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_charge_row_id;

  if v_charge_row_id is null then
    select
      charge.id,
      charge.ip_ticket_id,
      charge.item,
      charge.quantity,
      charge.rate_paise
    into
      v_charge_row_id,
      v_existing_ticket_id,
      v_existing_item,
      v_existing_quantity,
      v_existing_rate_paise
    from public.ip_charges charge
    where charge.idempotency_key = p_idempotency_key;

    if v_existing_ticket_id is distinct from p_ticket_id
      or v_existing_item is distinct from btrim(p_item)
      or v_existing_quantity is distinct from p_quantity
      or v_existing_rate_paise is distinct from p_rate_paise
    then
      raise exception 'idempotency key was reused with different charge details';
    end if;
  end if;

  return v_charge_row_id;
end;
$function$;

revoke all on function public.add_custom_ip_charge(
  uuid, text, integer, bigint, uuid
) from public, anon;

grant execute on function public.add_custom_ip_charge(
  uuid, text, integer, bigint, uuid
) to authenticated;

comment on function public.add_custom_ip_charge(
  uuid, text, integer, bigint, uuid
) is 'Adds an audited custom IP charge with an operator-entered item and fee.';

commit;
