-- The IP doctor visit charge was always the doctor's configured fee. A ward
-- round is not always worth the same as a detailed review, and a doctor may
-- waive it entirely, so the amount is now typed at the point of charging and
-- the configured fee is only the starting suggestion.
--
-- A null override keeps the old behaviour, so existing callers are unaffected.
begin;

create or replace function public.add_ip_progress_note(
  p_ticket_id uuid,
  p_note text,
  p_chargeable boolean,
  p_idempotency_key uuid,
  p_fee_paise bigint default null
)
returns uuid
language plpgsql security definer set search_path='' as $$
declare v_role public.app_role; v_doctor uuid; v_note uuid; v_fee bigint;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role is null or v_role not in ('admin','doctor') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_fee_paise is not null and p_fee_paise < 0 then
    raise exception 'fee must not be negative' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.ip_tickets
    where id = p_ticket_id and status = 'admitted' and (v_role = 'admin' or doctor_id = v_doctor)
  ) then
    raise exception 'IP ticket unavailable' using errcode='42501';
  end if;

  -- Same key returns the same note: a double-clicked Save must not charge twice.
  select id into v_note from public.ip_progress_notes where idempotency_key = p_idempotency_key;
  if v_note is not null then return v_note; end if;

  if v_role = 'admin' and v_doctor is null then
    select doctor_id into v_doctor from public.ip_tickets where id = p_ticket_id;
  end if;

  insert into public.ip_progress_notes(ip_ticket_id, doctor_id, note, chargeable, idempotency_key)
  values (p_ticket_id, v_doctor, p_note, p_chargeable, p_idempotency_key)
  returning id into v_note;

  if p_chargeable then
    if p_fee_paise is null then
      select ip_visit_fee_paise into v_fee from public.doctors where id = v_doctor;
    else
      v_fee := p_fee_paise;
    end if;
    insert into public.ip_charges(ip_ticket_id, category, item, quantity, rate_paise, source_type, source_id, idempotency_key)
    values (p_ticket_id, 'doctor', 'IP Doctor Visit', 1, coalesce(v_fee,0), 'ip_progress_note', v_note, p_idempotency_key);
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
  values (auth.uid(), 'IP_PROGRESS_NOTE_ADDED', 'ip_progress_note', v_note);
  return v_note;
end $$;

revoke all on function public.add_ip_progress_note(uuid,text,boolean,uuid,bigint) from public, anon;
grant execute on function public.add_ip_progress_note(uuid,text,boolean,uuid,bigint) to authenticated, service_role;

-- The four-argument version would otherwise stay callable and silently ignore a
-- typed fee, since PostgREST picks an overload by the arguments it is sent.
drop function if exists public.add_ip_progress_note(uuid,text,boolean,uuid);

commit;
