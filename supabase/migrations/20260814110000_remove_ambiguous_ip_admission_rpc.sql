begin;

-- The room-aware admission RPC supersedes this signature. Keeping both can
-- make PostgREST function resolution ambiguous even when room_bed_id is sent.
drop function if exists public.create_ip_ticket(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  public.payment_mode,
  boolean,
  uuid
);

revoke all on function public.create_ip_ticket(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  public.payment_mode,
  boolean,
  uuid,
  uuid
) from public;

grant execute on function public.create_ip_ticket(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  public.payment_mode,
  boolean,
  uuid,
  uuid
) to authenticated;

commit;
