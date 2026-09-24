-- Pearl Aesthetic CRM: security hardening.

-- 1. Profile role comes only from app_metadata.
--
-- user_metadata is writable by the account holder (and by anyone, through a
-- public sign-up if that is ever enabled), so a profile role must never be
-- read from it. app_metadata can be set only through the service-role Admin
-- API, which is exactly what the Users / Doctors screens and the first-admin
-- bootstrap use. An account created any other way gets no role: it lands
-- inactive, and current_app_role() is NULL for it everywhere.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  begin
    v_role := nullif(new.raw_app_meta_data ->> 'role', '')::public.app_role;
  exception when invalid_text_representation then
    v_role := null;
  end;
  if v_role = 'ip' then
    v_role := null;
  end if;

  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(v_role, 'reception'),
    case when v_role is null then 'inactive'::public.record_status else 'active'::public.record_status end
  );
  return new;
end
$$;

-- 2. Legacy token counter (replaced by daily_token_sequences) was the one
--    public table without RLS.
drop table if exists public.token_sequences;

-- 3. Pinned search_path on the one definer routine that still used `public`
--    (same body, schema-qualified).
create or replace function public.learn_medicine_field_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.medicine_field_options (field, value)
  select entered.field, entered.value
  from (
    values
      ('dosage_form', nullif(btrim(new.dosage_form), '')),
      ('manufacturer', nullif(btrim(new.manufacturer), '')),
      ('generic_name', nullif(btrim(new.generic_name), '')),
      ('strength', nullif(btrim(new.strength), ''))
  ) as entered(field, value)
  where entered.value is not null
  on conflict (field, value)
    do update set usage_count = public.medicine_field_options.usage_count + 1;
  return new;
end;
$$;

-- 4. No routine is callable without signing in.
--
-- Supabase grants EXECUTE on new public functions to anon by default. Revoke
-- it from every routine in the schema (triggers, helpers, RPCs alike), and
-- stop future functions inheriting it. Signed-in staff keep EXECUTE; every
-- RPC performs its own role check. Trigger-only and internal helpers are not
-- callable by staff either.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.is_trigger or r.proname = any(array[
      'next_lead_assignee', 'log_lead_activity', 'ingest_meta_lead',
      'expire_stale_waiting_visits_internal', 'prune_audit_logs'
    ]) then
      execute format('revoke execute on function %s from authenticated', r.sig);
    end if;
  end loop;
end $$;

grant execute on function public.ingest_meta_lead(jsonb) to service_role;

alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
