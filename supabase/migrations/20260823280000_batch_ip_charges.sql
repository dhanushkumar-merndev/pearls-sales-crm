-- Add multiple configured/custom IP charges in one atomic request. Each line
-- still uses the existing append-only charge workflow and therefore remains a
-- separate traceable ip_charges row with its own idempotency key.
begin;

create function public.add_ip_charges(
  p_ticket_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_line jsonb;
  v_mode text;
  v_count integer := 0;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) < 1
    or jsonb_array_length(p_lines) > 25
  then
    raise exception 'charge count must be between 1 and 25'
      using errcode = '22023';
  end if;

  perform 1
  from public.ip_tickets ticket
  where ticket.id = p_ticket_id
    and ticket.status in ('admitted', 'discharge_pending')
  for update;
  if not found then
    raise exception 'IP ticket is not open';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_mode := v_line->>'charge_mode';
    if v_mode = 'preset' then
      perform public.add_configured_ip_charge(
        p_ticket_id,
        (v_line->>'charge_preset_id')::uuid,
        (v_line->>'quantity')::integer,
        (v_line->>'idempotency_key')::uuid
      );
    elsif v_mode = 'custom' then
      perform public.add_custom_ip_charge(
        p_ticket_id,
        v_line->>'item',
        (v_line->>'quantity')::integer,
        (v_line->>'rate_paise')::bigint,
        (v_line->>'idempotency_key')::uuid
      );
    else
      raise exception 'unknown charge mode' using errcode = '22023';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.add_ip_charges(uuid, jsonb) from public, anon;
grant execute on function public.add_ip_charges(uuid, jsonb)
to authenticated, service_role;

comment on function public.add_ip_charges(uuid, jsonb) is
  'Atomically appends 1-25 configured/custom IP charge rows.';

commit;
