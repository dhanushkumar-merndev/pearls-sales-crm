-- Pearl Aesthetic CRM: leads, their activity trail, and the Meta Lead Ads
-- connection that feeds them.
--
-- Every write goes through a SECURITY DEFINER RPC (or the service role for the
-- Meta webhook), so the tables carry no write policies at all. Read policies
-- are defined with the rest of the role matrix in the RLS consolidation
-- migration that follows.

-- ---------------------------------------------------------------------------
-- Meta connection
-- ---------------------------------------------------------------------------

-- One row. Admin-readable status only: secrets live in the table below.
create table public.meta_integration (
  id boolean primary key default true check (id),
  app_id text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error')),
  verify_token_hint text,
  connected_at timestamptz,
  connected_by uuid references public.profiles(id) on delete set null,
  last_webhook_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.meta_integration (id) values (true);

-- App secret, System User token and webhook verify token, each encrypted by
-- the app (AES-256-GCM, INTEGRATION_ENCRYPTION_KEY) before it gets here.
-- RLS on with no policies and no grants: only the service role can read it.
create table public.meta_integration_secrets (
  id boolean primary key default true check (id),
  app_secret_enc text,
  access_token_enc text,
  verify_token_enc text,
  updated_at timestamptz not null default now()
);

create table public.meta_pages (
  page_id text primary key check (page_id ~ '^[0-9]{3,32}$'),
  name text not null,
  subscribed boolean not null default false,
  subscribed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Page access tokens (encrypted), service role only -- same rule as above.
create table public.meta_page_secrets (
  page_id text primary key references public.meta_pages(page_id) on delete cascade,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);

create table public.meta_lead_forms (
  form_id text primary key check (form_id ~ '^[0-9]{3,32}$'),
  page_id text not null references public.meta_pages(page_id) on delete restrict,
  name text not null,
  meta_status text,
  -- Questions as Meta returns them: [{ key, label, type }].
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  -- { "<question key>": "<crm field>" | "extra" | "ignore" }.
  field_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(field_mapping) = 'object'),
  default_procedure_interest text check (default_procedure_interest is null or length(default_procedure_interest) <= 120),
  assignment_mode text not null default 'round_robin'
    check (assignment_mode in ('round_robin', 'specific', 'unassigned')),
  assign_to uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  last_leadgen_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assignment_mode <> 'specific' or assign_to is not null)
);
create index meta_lead_forms_page_idx on public.meta_lead_forms(page_id);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual' check (source in ('meta', 'manual')),
  -- Meta's own id for the submission. Unique, so a webhook retry or a
  -- backfill that sees the same lead again can never create a second row.
  meta_leadgen_id text unique,
  meta_form_id text,
  meta_form_name text,
  meta_page_id text,
  meta_ad_id text,
  meta_ad_name text,
  meta_campaign_name text,
  platform text check (platform in ('facebook', 'instagram', 'other')),
  full_name text check (full_name is null or length(full_name) <= 160),
  -- What the person typed, always kept; the normalized 10-digit number only
  -- when it is a valid Indian mobile (a foreign number stays in phone_raw).
  phone_raw text check (phone_raw is null or length(phone_raw) <= 40),
  phone_normalized text check (phone_normalized is null or phone_normalized ~ '^[6-9][0-9]{9}$'),
  email text check (email is null or length(email) <= 254),
  city text check (city is null or length(city) <= 120),
  procedure_interest text check (procedure_interest is null or length(procedure_interest) <= 200),
  preferred_date text check (preferred_date is null or length(preferred_date) <= 120),
  message text check (message is null or length(message) <= 4000),
  -- Answers the admin kept but did not map to a CRM column.
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  -- The untouched Meta field_data, for audit and re-mapping.
  raw_field_data jsonb,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'interested', 'booked', 'converted', 'lost')),
  lost_reason text check (lost_reason is null or length(lost_reason) <= 500),
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  first_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  appointment_at timestamptz,
  patient_id uuid references public.patients(id) on delete restrict,
  converted_visit_id uuid references public.visits(id) on delete restrict,
  converted_at timestamptz,
  idempotency_key uuid unique,
  created_by uuid references public.profiles(id) on delete set null,
  -- When the person submitted the form (Meta created_time) or the enquiry
  -- was taken; received_at is when it reached the CRM.
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'meta' or meta_leadgen_id is not null),
  check (status <> 'lost' or lost_reason is not null),
  check (status not in ('booked', 'converted') or (appointment_at is not null and patient_id is not null)),
  check (status <> 'converted' or converted_visit_id is not null),
  check (full_name is not null or phone_raw is not null or email is not null)
);
create index leads_owner_queue_idx on public.leads(assigned_to, status, next_follow_up_at);
create index leads_status_received_idx on public.leads(status, received_at desc);
create index leads_received_idx on public.leads(received_at desc);
create index leads_phone_idx on public.leads(phone_normalized) where phone_normalized is not null;
create index leads_appointment_idx on public.leads(appointment_at) where status = 'booked';
create index leads_patient_idx on public.leads(patient_id) where patient_id is not null;
create index leads_form_idx on public.leads(meta_form_id, received_at desc) where meta_form_id is not null;
create index leads_owner_received_idx on public.leads(assigned_to, received_at desc);

create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meta_lead_forms
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meta_pages
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meta_integration
  for each row execute function public.set_updated_at();

-- Append-only timeline: calls, notes, status changes, assignment.
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  type text not null check (type in ('note', 'call', 'status_change', 'assignment', 'system')),
  body text check (body is null or length(body) <= 4000),
  from_status text,
  to_status text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities(lead_id, created_at desc);

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.meta_integration enable row level security;
alter table public.meta_integration_secrets enable row level security;
alter table public.meta_pages enable row level security;
alter table public.meta_page_secrets enable row level security;
alter table public.meta_lead_forms enable row level security;

revoke all on public.meta_integration_secrets, public.meta_page_secrets from anon, authenticated;
revoke insert, update, delete, truncate on public.leads, public.lead_activities,
  public.meta_integration, public.meta_pages, public.meta_lead_forms from anon, authenticated;
revoke all on public.leads, public.lead_activities, public.meta_integration,
  public.meta_pages, public.meta_lead_forms from anon;
grant select on public.leads, public.lead_activities, public.meta_integration,
  public.meta_pages, public.meta_lead_forms to authenticated;
grant all on public.leads, public.lead_activities, public.meta_integration,
  public.meta_integration_secrets, public.meta_pages, public.meta_page_secrets,
  public.meta_lead_forms to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Least-recently-assigned active sales executive. Serialized with an advisory
-- lock so two leads arriving together are spread across two people.
create or replace function public.next_lead_assignee()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  perform pg_advisory_xact_lock(hashtext('pearl_lead_assignment'));
  select p.id into v_profile
  from public.profiles p
  where p.role = 'sales_executive' and p.status = 'active'
  order by (
    select max(l.assigned_at) from public.leads l where l.assigned_to = p.id
  ) asc nulls first, p.id
  limit 1;
  return v_profile;
end;
$$;

create or replace function public.log_lead_activity(
  p_lead_id uuid,
  p_type text,
  p_body text,
  p_from_status text default null,
  p_to_status text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_activities (lead_id, type, body, from_status, to_status, created_by)
  values (p_lead_id, p_type, nullif(trim(p_body), ''), p_from_status, p_to_status, auth.uid());
$$;

-- Caller may work this lead: admin, or the sales executive it is assigned to.
create or replace function public.can_work_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.current_app_role() = 'admin'
        or (public.current_app_role() = 'sales_executive' and l.assigned_to = auth.uid())
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Ingest (service role only -- the Meta webhook and admin backfill)
-- ---------------------------------------------------------------------------

-- p_lead is already mapped by the app (src/features/meta/mapping.ts):
-- { leadgen_id, form_id, page_id, ad_id, ad_name, campaign_name, platform,
--   created_time, full_name, phone_raw, phone_normalized, email, city,
--   procedure_interest, preferred_date, message, extra, raw_field_data }
create or replace function public.ingest_meta_lead(p_lead jsonb)
returns table (lead_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.meta_lead_forms%rowtype;
  v_id uuid;
  v_assignee uuid;
  v_leadgen text := nullif(trim(p_lead ->> 'leadgen_id'), '');
  v_phone text := nullif(trim(p_lead ->> 'phone_normalized'), '');
begin
  if v_leadgen is null then
    raise exception 'leadgen_id is required' using errcode = '22023';
  end if;

  select l.id into v_id from public.leads l where l.meta_leadgen_id = v_leadgen;
  if found then
    return query select v_id, false;
    return;
  end if;

  select * into v_form from public.meta_lead_forms f where f.form_id = p_lead ->> 'form_id';

  if v_form.form_id is not null and v_form.assignment_mode = 'specific' then
    select p.id into v_assignee from public.profiles p
    where p.id = v_form.assign_to and p.role = 'sales_executive' and p.status = 'active';
  end if;
  if v_assignee is null and coalesce(v_form.assignment_mode, 'round_robin') <> 'unassigned' then
    v_assignee := public.next_lead_assignee();
  end if;

  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    v_phone := null;
  end if;

  insert into public.leads (
    source, meta_leadgen_id, meta_form_id, meta_form_name, meta_page_id, meta_ad_id,
    meta_ad_name, meta_campaign_name, platform, full_name, phone_raw, phone_normalized,
    email, city, procedure_interest, preferred_date, message, extra, raw_field_data,
    assigned_to, assigned_at, created_at
  )
  values (
    'meta', v_leadgen, p_lead ->> 'form_id', v_form.name, p_lead ->> 'page_id',
    nullif(p_lead ->> 'ad_id', ''), left(nullif(p_lead ->> 'ad_name', ''), 300),
    left(nullif(p_lead ->> 'campaign_name', ''), 300),
    case lower(coalesce(p_lead ->> 'platform', ''))
      when 'fb' then 'facebook' when 'facebook' then 'facebook'
      when 'ig' then 'instagram' when 'instagram' then 'instagram'
      else 'other' end,
    left(nullif(trim(p_lead ->> 'full_name'), ''), 160),
    left(nullif(trim(p_lead ->> 'phone_raw'), ''), 40),
    v_phone,
    left(nullif(lower(trim(p_lead ->> 'email')), ''), 254),
    left(nullif(trim(p_lead ->> 'city'), ''), 120),
    left(coalesce(nullif(trim(p_lead ->> 'procedure_interest'), ''), v_form.default_procedure_interest), 200),
    left(nullif(trim(p_lead ->> 'preferred_date'), ''), 120),
    left(nullif(trim(p_lead ->> 'message'), ''), 4000),
    coalesce(p_lead -> 'extra', '{}'::jsonb),
    p_lead -> 'raw_field_data',
    v_assignee,
    case when v_assignee is not null then now() end,
    coalesce((p_lead ->> 'created_time')::timestamptz, now())
  )
  on conflict (meta_leadgen_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a race with a concurrent delivery of the same lead.
    select l.id into v_id from public.leads l where l.meta_leadgen_id = v_leadgen;
    return query select v_id, false;
    return;
  end if;

  update public.meta_lead_forms set last_leadgen_at = now() where form_id = v_form.form_id;

  insert into public.lead_activities (lead_id, type, body)
  values (v_id, 'system', 'Lead received from Meta' || coalesce(' form "' || v_form.name || '"', ''));
  if v_assignee is not null then
    insert into public.lead_activities (lead_id, type, body)
    values (v_id, 'assignment', 'Auto-assigned (' || coalesce(v_form.assignment_mode, 'round_robin') || ')');
  end if;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values ('LEAD_RECEIVED', 'lead', v_id,
    jsonb_build_object('source', 'meta', 'form_id', p_lead ->> 'form_id', 'assigned_to', v_assignee));

  return query select v_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales executive / admin workflow
-- ---------------------------------------------------------------------------

create or replace function public.create_manual_lead(
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_city text default null,
  p_procedure_interest text default null,
  p_message text default null,
  p_assign_to uuid default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.current_app_role();
  v_id uuid;
  v_assignee uuid;
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
begin
  if v_role is null or v_role not in ('admin', 'sales_executive') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Enter the person''s name.' using errcode = '22023';
  end if;
  if v_digits !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit mobile number.' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.leads where idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;

  if v_role = 'sales_executive' then
    v_assignee := auth.uid();
  elsif p_assign_to is not null then
    select id into v_assignee from public.profiles
    where id = p_assign_to and role = 'sales_executive' and status = 'active';
    if v_assignee is null then
      raise exception 'Choose an active sales executive.' using errcode = '22023';
    end if;
  else
    v_assignee := public.next_lead_assignee();
  end if;

  insert into public.leads (
    source, full_name, phone_raw, phone_normalized, email, city, procedure_interest,
    message, assigned_to, assigned_at, idempotency_key, created_by
  )
  values (
    'manual', left(trim(p_full_name), 160), left(trim(p_phone), 40), v_digits,
    left(nullif(lower(trim(p_email)), ''), 254), left(nullif(trim(p_city), ''), 120),
    left(nullif(trim(p_procedure_interest), ''), 200), left(nullif(trim(p_message), ''), 4000),
    v_assignee, case when v_assignee is not null then now() end, p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  perform public.log_lead_activity(v_id, 'system', 'Enquiry added manually');
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_RECEIVED', 'lead', v_id,
    jsonb_build_object('source', 'manual', 'assigned_to', v_assignee));
  return v_id;
end;
$$;

-- Manual pipeline moves. "booked" happens only through convert_lead and
-- "converted" only when reception creates the visit.
create or replace function public.update_lead_status(
  p_lead_id uuid,
  p_status text,
  p_note text default null,
  p_next_follow_up_at timestamptz default null,
  p_lost_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
begin
  if not public.can_work_lead(p_lead_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('contacted', 'interested', 'lost') then
    raise exception 'Use Book appointment to book, and reception converts on arrival.' using errcode = '22023';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.status = 'converted' then
    raise exception 'A converted lead is closed.' using errcode = '22023';
  end if;
  if p_status = 'lost' and length(trim(coalesce(p_lost_reason, ''))) < 2 then
    raise exception 'Give a reason for marking the lead lost.' using errcode = '22023';
  end if;

  update public.leads set
    status = p_status,
    lost_reason = case when p_status = 'lost' then left(trim(p_lost_reason), 500) end,
    first_contacted_at = coalesce(first_contacted_at, now()),
    next_follow_up_at = case when p_status = 'lost' then null else p_next_follow_up_at end,
    -- Leaving "booked" (no-show, reschedule) releases the appointment.
    appointment_at = null
  where id = p_lead_id;

  perform public.log_lead_activity(p_lead_id, 'status_change',
    coalesce(nullif(trim(p_note), ''), case when p_status = 'lost' then p_lost_reason end),
    v_lead.status, p_status);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_STATUS_CHANGED', 'lead', p_lead_id,
    jsonb_build_object('from', v_lead.status, 'to', p_status));
end;
$$;

-- A call or note; optionally reschedules the next follow-up. Logging a call
-- on a new lead counts as first contact.
create or replace function public.add_lead_note(
  p_lead_id uuid,
  p_type text,
  p_body text,
  p_next_follow_up_at timestamptz default null,
  p_clear_follow_up boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.can_work_lead(p_lead_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type not in ('note', 'call') then
    raise exception 'invalid activity type' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) < 1 and p_next_follow_up_at is null and not p_clear_follow_up then
    raise exception 'Write a note or set a follow-up.' using errcode = '22023';
  end if;

  select status into v_status from public.leads where id = p_lead_id for update;
  update public.leads set
    next_follow_up_at = case
      when p_clear_follow_up then null
      else coalesce(p_next_follow_up_at, next_follow_up_at) end,
    first_contacted_at = case when p_type = 'call' then coalesce(first_contacted_at, now()) else first_contacted_at end,
    status = case when p_type = 'call' and status = 'new' then 'contacted' else status end
  where id = p_lead_id;

  perform public.log_lead_activity(p_lead_id, p_type,
    concat_ws(' · ', nullif(trim(p_body), ''),
      case when p_next_follow_up_at is not null
        then 'Follow-up ' || to_char(p_next_follow_up_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') end),
    case when p_type = 'call' and v_status = 'new' then 'new' end,
    case when p_type = 'call' and v_status = 'new' then 'contacted' end);
end;
$$;

create or replace function public.assign_lead(p_lead_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_previous uuid;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_profile_id is not null then
    select full_name into v_name from public.profiles
    where id = p_profile_id and role = 'sales_executive' and status = 'active';
    if v_name is null then
      raise exception 'Choose an active sales executive.' using errcode = '22023';
    end if;
  end if;
  select assigned_to into v_previous from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  update public.leads
  set assigned_to = p_profile_id, assigned_at = case when p_profile_id is not null then now() end
  where id = p_lead_id;
  perform public.log_lead_activity(p_lead_id, 'assignment',
    coalesce('Assigned to ' || v_name, 'Unassigned'));
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_ASSIGNED', 'lead', p_lead_id,
    jsonb_build_object('from', v_previous, 'to', p_profile_id));
end;
$$;

-- Existing patients on the lead's phone, so the sales executive links rather
-- than duplicates. Identity only (no clinical data): the role has no read on
-- public.patients.
create or replace function public.find_lead_patient_matches(p_lead_id uuid)
returns table (patient_id uuid, name text, uhid text, gender text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_work_lead(p_lead_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.uhid, p.gender::text, p.created_at
  from public.leads l
  join public.patients p on p.phone_normalized = l.phone_normalized and p.status = 'active'
  where l.id = p_lead_id
  order by p.created_at
  limit 10;
end;
$$;

-- Books the appointment: links (or registers) the patient and moves the lead
-- to "booked". Visits, tokens and payments stay with reception.
create or replace function public.convert_lead(
  p_lead_id uuid,
  p_appointment_at timestamptz,
  p_patient_id uuid default null,
  p_patient_name text default null,
  p_gender text default 'unknown',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_patient uuid;
  v_name text;
begin
  if not public.can_work_lead(p_lead_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_appointment_at is null or p_appointment_at < now() - interval '1 day' then
    raise exception 'Pick an appointment date and time.' using errcode = '22023';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.status = 'converted' then
    raise exception 'A converted lead is closed.' using errcode = '22023';
  end if;

  if p_patient_id is not null then
    select p.id into v_patient from public.patients p
    where p.id = p_patient_id and p.status = 'active'
      and p.phone_normalized = v_lead.phone_normalized;
    if v_patient is null then
      raise exception 'That patient does not match this lead''s phone number.' using errcode = '22023';
    end if;
  elsif v_lead.patient_id is not null then
    v_patient := v_lead.patient_id;
  else
    if v_lead.phone_normalized is null then
      raise exception 'Add a valid 10-digit mobile number before booking.' using errcode = '22023';
    end if;
    v_name := coalesce(nullif(trim(p_patient_name), ''), v_lead.full_name);
    if length(trim(coalesce(v_name, ''))) < 2 then
      raise exception 'Enter the patient''s name.' using errcode = '22023';
    end if;
    insert into public.patients (phone_normalized, name, gender, reference_detail)
    values (
      v_lead.phone_normalized, left(trim(v_name), 160),
      case when p_gender in ('male', 'female', 'other') then p_gender::public.gender else 'unknown'::public.gender end,
      left('Lead: ' || coalesce(v_lead.meta_campaign_name, v_lead.meta_form_name, initcap(v_lead.source)), 200)
    )
    returning id into v_patient;
  end if;

  update public.leads set
    status = 'booked',
    patient_id = v_patient,
    appointment_at = p_appointment_at,
    next_follow_up_at = null,
    lost_reason = null,
    first_contacted_at = coalesce(first_contacted_at, now())
  where id = p_lead_id;

  perform public.log_lead_activity(p_lead_id, 'status_change',
    concat_ws(' · ', 'Appointment ' || to_char(p_appointment_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM'),
      nullif(trim(p_note), '')),
    v_lead.status, 'booked');
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_STATUS_CHANGED', 'lead', p_lead_id,
    jsonb_build_object('from', v_lead.status, 'to', 'booked', 'patient_id', v_patient));
  return v_patient;
end;
$$;

-- Reception's "Lead Appointments" list for a hospital-local day.
create or replace function public.list_lead_appointments(p_date date default null)
returns table (
  lead_id uuid,
  full_name text,
  phone_normalized text,
  procedure_interest text,
  appointment_at timestamptz,
  status text,
  patient_id uuid,
  patient_name text,
  patient_uhid text,
  sales_executive text,
  converted_visit_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin', 'reception') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select l.id, l.full_name, l.phone_normalized, l.procedure_interest, l.appointment_at,
    l.status, l.patient_id, p.name, p.uhid, owner.full_name, l.converted_visit_id
  from public.leads l
  left join public.patients p on p.id = l.patient_id
  left join public.profiles owner on owner.id = l.assigned_to
  where l.status in ('booked', 'converted')
    and (l.appointment_at at time zone 'Asia/Kolkata')::date = v_day
  order by l.appointment_at;
end;
$$;

-- A visit created for a patient with a booked lead converts that lead, on
-- every visit-creation path (single consultant, multi consultant, follow-up).
create or replace function public.convert_booked_lead_on_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  select l.id into v_lead
  from public.leads l
  where l.patient_id = new.patient_id and l.status = 'booked'
  order by abs(extract(epoch from (l.appointment_at - new.created_at))), l.appointment_at
  limit 1
  for update;
  if v_lead is null then
    return new;
  end if;
  update public.leads
  set status = 'converted', converted_visit_id = new.id, converted_at = now()
  where id = v_lead;
  insert into public.lead_activities (lead_id, type, body, from_status, to_status, created_by)
  values (v_lead, 'status_change', 'Visit created at reception', 'booked', 'converted', auth.uid());
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_CONVERTED', 'lead', v_lead, jsonb_build_object('visit_id', new.id));
  return new;
end;
$$;

create trigger convert_booked_lead_on_visit
after insert on public.visits
for each row execute function public.convert_booked_lead_on_visit();

-- Admin lead analytics for a date range (hospital-local days).
create or replace function public.report_leads(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  v_result jsonb;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with scoped as (
    select * from public.leads where received_at >= v_from and received_at < v_to
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
      select status, count(*) n from scoped group by status) s), '{}'::jsonb),
    'converted', (select count(*) from scoped where status = 'converted'),
    'booked_or_converted', (select count(*) from scoped where status in ('booked', 'converted')),
    'lost', (select count(*) from scoped where status = 'lost'),
    'unassigned', (select count(*) from scoped where assigned_to is null),
    'median_hours_to_first_contact', (
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from (first_contacted_at - received_at)) / 3600))::numeric, 1)
      from scoped where first_contacted_at is not null),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', lead_day, 'leads', leads, 'converted', converted) order by lead_day) from (
      select (received_at at time zone 'Asia/Kolkata')::date as lead_day, count(*) as leads,
        count(*) filter (where status = 'converted') converted
      from scoped group by 1) d), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', label, 'leads', leads, 'converted', converted) order by leads desc) from (
      select coalesce(meta_form_name, case when source = 'manual' then 'Manual enquiry' else 'Meta (unmapped form)' end) label,
        count(*) leads, count(*) filter (where status = 'converted') converted
      from scoped group by 1) s), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object('campaign', campaign, 'leads', leads, 'converted', converted) order by leads desc) from (
      select meta_campaign_name campaign, count(*) leads, count(*) filter (where status = 'converted') converted
      from scoped where meta_campaign_name is not null group by 1 order by 2 desc limit 15) c), '[]'::jsonb),
    'by_owner', coalesce((select jsonb_agg(jsonb_build_object(
        'owner', coalesce(p.full_name, 'Unassigned'), 'leads', o.leads, 'contacted', o.contacted,
        'booked', o.booked, 'converted', o.converted, 'lost', o.lost) order by o.leads desc) from (
      select assigned_to, count(*) leads,
        count(*) filter (where first_contacted_at is not null) contacted,
        count(*) filter (where status in ('booked', 'converted')) booked,
        count(*) filter (where status = 'converted') converted,
        count(*) filter (where status = 'lost') lost
      from scoped group by assigned_to) o
      left join public.profiles p on p.id = o.assigned_to), '[]'::jsonb),
    'by_procedure', coalesce((select jsonb_agg(jsonb_build_object('procedure', procedure_interest, 'leads', leads) order by leads desc) from (
      select procedure_interest, count(*) leads from scoped
      where procedure_interest is not null group by 1 order by 2 desc limit 12) p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Realtime: sales executives see a newly assigned lead without reloading.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads') then
      alter publication supabase_realtime add table public.leads;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_activities') then
      alter publication supabase_realtime add table public.lead_activities;
    end if;
  end if;
end $$;

revoke execute on function
  public.next_lead_assignee(),
  public.log_lead_activity(uuid, text, text, text, text),
  public.convert_booked_lead_on_visit(),
  public.ingest_meta_lead(jsonb)
from public, anon, authenticated;
grant execute on function public.ingest_meta_lead(jsonb) to service_role;

revoke execute on function
  public.can_work_lead(uuid),
  public.create_manual_lead(text, text, text, text, text, text, uuid, uuid),
  public.update_lead_status(uuid, text, text, timestamptz, text),
  public.add_lead_note(uuid, text, text, timestamptz, boolean),
  public.assign_lead(uuid, uuid),
  public.find_lead_patient_matches(uuid),
  public.convert_lead(uuid, timestamptz, uuid, text, text, text),
  public.list_lead_appointments(date),
  public.report_leads(date, date)
from public, anon;
grant execute on function
  public.can_work_lead(uuid),
  public.create_manual_lead(text, text, text, text, text, text, uuid, uuid),
  public.update_lead_status(uuid, text, text, timestamptz, text),
  public.add_lead_note(uuid, text, text, timestamptz, boolean),
  public.assign_lead(uuid, uuid),
  public.find_lead_patient_matches(uuid),
  public.convert_lead(uuid, timestamptz, uuid, text, text, text),
  public.list_lead_appointments(date),
  public.report_leads(date, date)
to authenticated;
