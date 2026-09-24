-- Removing any master record without rewriting hospital history.
--
-- delete_medicine proved the shape: delete outright when nothing references
-- the row, archive when history depends on it. Every other master needs the
-- same, and two of them need it for reasons the foreign keys do NOT provide.
--
--   * A clinical term is referenced by consultation_diagnoses.term_id with
--     ON DELETE SET NULL. A plain delete therefore SUCCEEDS and silently
--     blanks the link on every past diagnosis that used it. That is exactly
--     the outcome this is supposed to prevent, and no error would ever have
--     been raised, so the check has to be explicit rather than left to the FK.
--   * A staff profile is referenced by twenty-odd tables recording who did
--     what. It is never deleted once someone has worked a shift; it is
--     deactivated, and their name stays on everything they did.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'clinical_terms','doctors','departments','charges','room_beds','report_categories'
  ] loop
    execute format(
      'alter table public.%I
         add column if not exists archived_at timestamptz,
         add column if not exists archived_by uuid references public.profiles(id) on delete set null', t);
    execute format(
      'create index if not exists %I on public.%I (archived_at) where archived_at is not null',
      t || '_archived_idx', t);
  end loop;
end $$;

/**
 * Admin-only removal for one master record, choosing the safe removal itself.
 *
 * The entity name never reaches SQL except through the whitelist below, so a
 * caller cannot name a table this was not meant to touch.
 */
create or replace function public.delete_master_record(p_entity text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_label_col text;
  v_in_use text;
  v_label text;
  v_archived boolean;
  v_used boolean := false;
  v_mode text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- entity -> table, the column that names it for the audit trail, and an
  -- optional predicate for references a foreign key would NOT refuse.
  select m.t, m.l, m.u into v_table, v_label_col, v_in_use
  from (values
    ('clinical_term',  'clinical_terms',    'display_text',
     'exists(select 1 from public.consultation_diagnoses where term_id = $1)'),
    ('doctor',         'doctors',           'display_name',  null),
    ('department',     'departments',       'name',          null),
    ('charge',         'charges',           'charge_name',   null),
    ('room_bed',       'room_beds',         'room_number',   null),
    ('report_category','report_categories', 'name',          null)
  ) as m(e, t, l, u)
  where m.e = p_entity;
  if v_table is null then
    raise exception 'unknown master entity' using errcode = '22023';
  end if;

  execute format(
    'select %I, archived_at is not null from public.%I where id = $1 for update',
    v_label_col, v_table)
  into v_label, v_archived using p_id;
  if v_label is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if v_archived then
    return jsonb_build_object('mode', 'archived', 'label', v_label, 'entity', p_entity);
  end if;

  if v_in_use is not null then
    execute 'select ' || v_in_use into v_used using p_id;
  end if;

  if v_used then
    v_mode := 'archived';
  else
    -- The sub-block is what makes the choice safe for everything else: any
    -- restricting reference, including one a later migration adds that this
    -- function has never heard of, rolls the attempt back to here.
    begin
      execute format('delete from public.%I where id = $1', v_table) using p_id;
      v_mode := 'deleted';
    exception when foreign_key_violation then
      v_mode := 'archived';
    end;
  end if;

  if v_mode = 'archived' then
    execute format(
      'update public.%I set active = false, archived_at = now(), archived_by = auth.uid() where id = $1',
      v_table) using p_id;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when v_mode = 'deleted' then 'MASTER_RECORD_DELETED' else 'MASTER_RECORD_ARCHIVED' end,
    p_entity, p_id, jsonb_build_object('label', v_label)
  );
  return jsonb_build_object('mode', v_mode, 'label', v_label, 'entity', p_entity);
end;
$$;

revoke all on function public.delete_master_record(text, uuid) from public, anon;
grant execute on function public.delete_master_record(text, uuid) to authenticated, service_role;

/** The way back, so a removal is never a dead end. */
create or replace function public.restore_master_record(p_entity text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_label_col text;
  v_label text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select m.t, m.l into v_table, v_label_col
  from (values
    ('clinical_term','clinical_terms','display_text'),
    ('doctor','doctors','display_name'),
    ('department','departments','name'),
    ('charge','charges','charge_name'),
    ('room_bed','room_beds','room_number'),
    ('report_category','report_categories','name')
  ) as m(e, t, l)
  where m.e = p_entity;
  if v_table is null then
    raise exception 'unknown master entity' using errcode = '22023';
  end if;

  execute format(
    'update public.%I set active = true, archived_at = null, archived_by = null
     where id = $1 and archived_at is not null returning %I',
    v_table, v_label_col)
  into v_label using p_id;
  if v_label is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'MASTER_RECORD_RESTORED', p_entity, p_id, jsonb_build_object('label', v_label));
  return jsonb_build_object('mode', 'restored', 'label', v_label, 'entity', p_entity);
end;
$$;

revoke all on function public.restore_master_record(text, uuid) from public, anon;
grant execute on function public.restore_master_record(text, uuid) to authenticated, service_role;

/**
 * Removing a staff account.
 *
 * A profile is who did the work: it is on every patient they registered, every
 * payment they collected and every audit row they caused. An account that has
 * done anything is therefore deactivated, never deleted -- deleting it would
 * either be refused by twenty foreign keys or, worse, erase the attribution.
 * An account created by mistake that has never touched a record is removed for
 * real, and the caller then removes its sign-in.
 *
 * Two things it refuses outright: removing yourself, and removing the last
 * administrator, either of which locks the hospital out of its own system.
 */
create or replace function public.delete_staff_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_role public.app_role;
  v_admins integer;
  v_mode text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot remove your own account' using errcode = '23514';
  end if;

  select full_name, role into v_name, v_role
  from public.profiles where id = p_user_id for update;
  if v_name is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    select count(*) into v_admins
    from public.profiles where role = 'admin' and status = 'active' and id <> p_user_id;
    if v_admins = 0 then
      raise exception 'the last administrator cannot be removed' using errcode = '23514';
    end if;
  end if;

  begin
    -- A doctor account owns a doctors row; that master is removed on its own
    -- terms, so only the link is dropped here.
    update public.doctors set profile_id = null where profile_id = p_user_id;
    delete from public.notification_reads where user_id = p_user_id;
    delete from public.profiles where id = p_user_id;
    v_mode := 'deleted';
  exception when foreign_key_violation then
    v_mode := 'deactivated';
  end;

  if v_mode = 'deactivated' then
    update public.profiles set status = 'inactive' where id = p_user_id;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when v_mode = 'deleted' then 'STAFF_ACCOUNT_DELETED' else 'STAFF_ACCOUNT_DEACTIVATED' end,
    'profile', p_user_id, jsonb_build_object('full_name', v_name, 'role', v_role)
  );
  return jsonb_build_object('mode', v_mode, 'label', v_name);
end;
$$;

revoke all on function public.delete_staff_profile(uuid) from public, anon;
grant execute on function public.delete_staff_profile(uuid) to authenticated, service_role;

commit;
