-- Deny inactive accounts even in legacy SECURITY DEFINER routines. In SQL,
-- NULL NOT IN (...) and NULL <> 'admin' are NULL, so IF skips the rejection.
-- Restrict the rewrite to negative role predicates at the start of an IF;
-- positive role checks and already null-safe guards are unchanged.
do $$
declare
  routine record;
  definition text;
  hardened text;
begin
  for routine in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  loop
    definition := pg_get_functiondef(routine.oid);
    hardened := regexp_replace(definition,
      '(\mif\s+)(public\.current_app_role\(\)|v_role)(\s+(?:not\s+in\s*\(|<>|!=))',
      '\1\2 is null or \2\3', 'gi');
    if hardened <> definition then execute hardened; end if;
  end loop;
end $$;

-- Serialize retries before looking up a manual enquiry's idempotency key.
-- A key must not disclose another staff member's enquiry ID. A different
-- payload on a replay is rejected instead of silently returning old data.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_manual_lead(text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  definition := replace(definition,
    'if p_idempotency_key is not null then',
    'if p_idempotency_key is null then
       raise exception ''An idempotency key is required.'' using errcode = ''22023'';
     end if;
     if p_idempotency_key is not null then
       perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));');
  definition := replace(definition, 'if found then return v_id; end if;',
    'if found then
       if not public.can_work_lead(v_id) then
         raise exception ''forbidden'' using errcode = ''42501'';
       end if;
       if not exists (select 1 from public.leads l where l.id = v_id
         and l.full_name = left(trim(p_full_name), 160)
         and l.phone_normalized = v_digits) then
         raise exception ''This form was already submitted with different details.'' using errcode = ''22023'';
       end if;
       return v_id;
     end if;');
  execute definition;
end $$;

-- Reassignment can race with a salesperson saving a note/status/booking.
-- Lock first, then authorize against the current owner, after any wait.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.update_lead_status(uuid,text,text,timestamptz,text)',
    'public.add_lead_note(uuid,text,text,timestamptz,boolean)',
    'public.convert_lead(uuid,timestamptz,uuid,text,text,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition, 'if not public.can_work_lead(p_lead_id) then',
      'perform 1 from public.leads where id = p_lead_id for update;
       if not public.can_work_lead(p_lead_id) then');
    execute definition;
  end loop;
end $$;

-- Inactive/unconfigured forms must not create leads or consume assignments,
-- including when ingest_meta_lead is called directly by a server worker.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.ingest_meta_lead(jsonb)'::regprocedure);
  definition := replace(definition,
    'select * into v_form from public.meta_lead_forms f where f.form_id = p_lead ->> ''form_id'';',
    'select * into v_form from public.meta_lead_forms f
       where f.form_id = p_lead ->> ''form_id'' and f.page_id = p_lead ->> ''page_id'' and f.active;
     if not found then
       raise exception ''Lead form is not configured or active.'' using errcode = ''22023'';
     end if;');
  execute definition;
end $$;

-- Indexed prefix searches; the app never downloads the whole lead directory.
alter table public.leads add column name_search text
  generated always as (lower(coalesce(full_name, ''))) stored;
create index leads_name_prefix_idx on public.leads(name_search text_pattern_ops);
create index leads_phone_prefix_idx on public.leads(phone_normalized text_pattern_ops);

-- A booking retry with identical details must not add duplicate timeline rows.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.convert_lead(uuid,timestamptz,uuid,text,text,text)'::regprocedure);
  definition := replace(definition, 'if p_patient_id is not null then',
    'if v_lead.status = ''booked'' and v_lead.appointment_at = p_appointment_at
       and (p_patient_id is null or p_patient_id = v_lead.patient_id) then
       return v_lead.patient_id;
     end if;
     if p_patient_id is not null then');
  execute definition;
end $$;
