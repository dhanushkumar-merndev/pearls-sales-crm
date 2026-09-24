begin;

-- IP progress notes become a proper consultation note: vitals, chief
-- complaint, issues, examination and plan, alongside the free-text note
-- (kept as "Additional notes"). All new columns are nullable so existing
-- rows and a plan-only or vitals-only entry both stay valid.
alter table public.ip_progress_notes
  add column if not exists pulse text,
  add column if not exists bp text,
  add column if not exists spo2 text,
  add column if not exists respiratory_rate text,
  add column if not exists chief_complaint text,
  add column if not exists issues text,
  add column if not exists examination text,
  add column if not exists plan text;

alter table public.ip_progress_notes alter column note drop not null;

create or replace function public.add_ip_progress_note(
  p_ticket_id uuid,
  p_note text,
  p_chargeable boolean,
  p_idempotency_key uuid,
  p_fee_paise bigint default null,
  p_pulse text default null,
  p_bp text default null,
  p_spo2 text default null,
  p_respiratory_rate text default null,
  p_chief_complaint text default null,
  p_issues text default null,
  p_examination text default null,
  p_plan text default null
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

  select id into v_note from public.ip_progress_notes where idempotency_key = p_idempotency_key;
  if v_note is not null then return v_note; end if;

  if v_role = 'admin' and v_doctor is null then
    select doctor_id into v_doctor from public.ip_tickets where id = p_ticket_id;
  end if;

  insert into public.ip_progress_notes(
    ip_ticket_id, doctor_id, note, chargeable, idempotency_key,
    pulse, bp, spo2, respiratory_rate, chief_complaint, issues, examination, plan
  )
  values (
    p_ticket_id, v_doctor, nullif(trim(coalesce(p_note,'')),''), p_chargeable, p_idempotency_key,
    nullif(trim(coalesce(p_pulse,'')),''), nullif(trim(coalesce(p_bp,'')),''), nullif(trim(coalesce(p_spo2,'')),''),
    nullif(trim(coalesce(p_respiratory_rate,'')),''), nullif(trim(coalesce(p_chief_complaint,'')),''),
    nullif(trim(coalesce(p_issues,'')),''), nullif(trim(coalesce(p_examination,'')),''), nullif(trim(coalesce(p_plan,'')),'')
  )
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

revoke all on function public.add_ip_progress_note(uuid,text,boolean,uuid,bigint,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.add_ip_progress_note(uuid,text,boolean,uuid,bigint,text,text,text,text,text,text,text,text) to authenticated, service_role;

-- The five-argument version would otherwise stay callable and silently drop
-- every new field, since PostgREST picks an overload by the arguments sent.
drop function if exists public.add_ip_progress_note(uuid,text,boolean,uuid,bigint);

commit;
