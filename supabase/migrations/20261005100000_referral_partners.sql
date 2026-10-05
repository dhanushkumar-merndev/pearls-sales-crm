-- Referral partners and conversion incentives.
--
-- A referral partner (salon, gym, doctor, influencer ...) sends enquiries to
-- the clinic and earns a percentage of what the clinic actually COLLECTS from
-- the converted patient, capped at the package value agreed at conversion.
--
-- Access:
--   * referral_partners, lead_packages: admin only (RLS). Package values,
--     incentive rates and payouts are finance.
--   * Sales executives only pick a partner's NAME when logging an enquiry,
--     through list_referral_partner_options(); they never read rates or payouts.
--   * Every write goes through a SECURITY DEFINER RPC with its own role check
--     and audit row, so neither table has an INSERT/UPDATE policy.
--
-- "Amount collected" is derived from real payment rows, never typed in:
-- visit_payments on the patient's visits + procedure bills, recorded on or
-- after the lead's conversion. Pharmacy medicine sales are not counted.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  organization text check (organization is null or length(organization) <= 160),
  phone_normalized text check (phone_normalized is null or phone_normalized ~ '^[6-9][0-9]{9}$'),
  -- Basis points: 1000 = 10.00 %.
  default_incentive_bps integer not null default 0 check (default_incentive_bps between 0 and 10000),
  notes text check (notes is null or length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index referral_partners_name_key on public.referral_partners (lower(btrim(name)));
create trigger set_updated_at before update on public.referral_partners
  for each row execute function public.set_updated_at();

alter table public.leads
  add column referral_partner_id uuid references public.referral_partners(id) on delete restrict;
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('meta', 'manual', 'referral'));
alter table public.leads add constraint leads_referral_partner_check
  check (source <> 'referral' or referral_partner_id is not null);
create index leads_referral_partner_idx on public.leads(referral_partner_id, converted_at desc)
  where referral_partner_id is not null;
-- The report scans booked/converted leads by conversion date.
create index leads_converted_at_idx on public.leads(converted_at desc) where status = 'converted';

-- One package / incentive record per lead.
create table public.lead_packages (
  lead_id uuid primary key references public.leads(id) on delete restrict,
  package_name text not null check (length(btrim(package_name)) between 2 and 200),
  package_value_paise bigint not null check (package_value_paise >= 0),
  incentive_bps integer not null default 0 check (incentive_bps between 0 and 10000),
  payout_status text not null default 'pending'
    check (payout_status in ('pending', 'paid', 'not_eligible')),
  -- Snapshot of the incentive actually paid, so later collections never
  -- rewrite a settled payout.
  paid_amount_paise bigint check (paid_amount_paise is null or paid_amount_paise >= 0),
  paid_at timestamptz,
  payout_reference text check (payout_reference is null or length(payout_reference) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payout_status <> 'paid' or (paid_amount_paise is not null and paid_at is not null)),
  check (payout_status = 'paid' or (paid_amount_paise is null and paid_at is null))
);
create trigger set_updated_at before update on public.lead_packages
  for each row execute function public.set_updated_at();

alter table public.referral_partners enable row level security;
alter table public.lead_packages enable row level security;
revoke all on public.referral_partners, public.lead_packages from anon, authenticated;
grant select on public.referral_partners, public.lead_packages to authenticated;
grant all on public.referral_partners, public.lead_packages to service_role;

create policy referral_partners_admin_read on public.referral_partners for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy lead_packages_admin_read on public.lead_packages for select to authenticated
  using ((select public.current_app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Money the clinic collected from a patient on/after a moment (conversion).
create or replace function public.patient_collected_since(p_patient_id uuid, p_since timestamptz)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when p_patient_id is null or p_since is null then 0::bigint else (
    coalesce((
      select sum(payment.amount_paise)
      from public.visit_payments payment
      join public.visits visit on visit.id = payment.visit_id
      where visit.patient_id = p_patient_id and payment.created_at >= p_since
    ), 0)
    + coalesce((
      select sum(sale.total_paise)
      from public.procedure_sales sale
      where sale.patient_id = p_patient_id and sale.created_at >= p_since
    ), 0)
  )::bigint end;
$$;

-- Incentive on collections, capped at the agreed package value. Integer
-- arithmetic, rounded half-up to the paise.
create or replace function public.referral_incentive_paise(
  p_collected_paise bigint, p_package_value_paise bigint, p_bps integer
) returns bigint language sql immutable set search_path = '' as $$
  select ((least(greatest(p_collected_paise, 0), greatest(p_package_value_paise, 0)) * greatest(p_bps, 0) + 5000) / 10000)::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Partner master
-- ---------------------------------------------------------------------------

create or replace function public.save_referral_partner(
  p_id uuid, p_name text, p_organization text, p_phone text,
  p_incentive_bps integer, p_notes text, p_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_digits text := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '');
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Enter the partner name.' using errcode = '22023';
  end if;
  if v_digits is not null and v_digits !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit mobile number.' using errcode = '22023';
  end if;
  if p_incentive_bps is null or p_incentive_bps not between 0 and 10000 then
    raise exception 'Incentive must be between 0 and 100 percent.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.referral_partners (name, organization, phone_normalized, default_incentive_bps, notes, active)
    values (left(btrim(p_name), 160), left(nullif(btrim(p_organization), ''), 160), v_digits,
      p_incentive_bps, left(nullif(btrim(p_notes), ''), 1000), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.referral_partners set
      name = left(btrim(p_name), 160), organization = left(nullif(btrim(p_organization), ''), 160),
      phone_normalized = v_digits, default_incentive_bps = p_incentive_bps,
      notes = left(nullif(btrim(p_notes), ''), 1000), active = coalesce(p_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Referral partner not found.' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'REFERRAL_PARTNER_SAVED', 'referral_partner', v_id,
    jsonb_build_object('created', p_id is null, 'active', coalesce(p_active, true)));
  return v_id;
exception when unique_violation then
  raise exception 'A partner with this name already exists.' using errcode = '22023';
end $$;

-- Names only, for the "Referred by" picker.
create or replace function public.list_referral_partner_options()
returns table (id uuid, name text) language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_app_role() is null or public.current_app_role() not in ('admin', 'sales_executive') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.name from public.referral_partners p
    where p.active order by lower(p.name) limit 500;
end $$;

-- ---------------------------------------------------------------------------
-- Manual enquiries may name the partner who referred them.
-- ---------------------------------------------------------------------------

drop function public.create_manual_lead(text, text, text, text, text, text, uuid, uuid);
create function public.create_manual_lead(
  p_full_name text, p_phone text, p_email text default null, p_city text default null,
  p_procedure_interest text default null, p_message text default null,
  p_assign_to uuid default null, p_idempotency_key uuid default null,
  p_referral_partner_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.current_app_role();
  v_id uuid;
  v_assignee uuid;
  v_partner uuid;
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
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id into v_id from public.leads where idempotency_key = p_idempotency_key;
  if found then
    if not public.can_work_lead(v_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not exists (select 1 from public.leads l where l.id = v_id
      and l.full_name = left(trim(p_full_name), 160)
      and l.phone_normalized = v_digits) then
      raise exception 'This form was already submitted with different details.' using errcode = '22023';
    end if;
    return v_id;
  end if;

  if p_referral_partner_id is not null then
    select id into v_partner from public.referral_partners
    where id = p_referral_partner_id and active;
    if v_partner is null then
      raise exception 'Choose an active referral partner.' using errcode = '22023';
    end if;
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
    source, referral_partner_id, full_name, phone_raw, phone_normalized, email, city,
    procedure_interest, message, assigned_to, assigned_at, idempotency_key, created_by
  )
  values (
    case when v_partner is null then 'manual' else 'referral' end, v_partner,
    left(trim(p_full_name), 160), left(trim(p_phone), 40), v_digits,
    left(nullif(lower(trim(p_email)), ''), 254), left(nullif(trim(p_city), ''), 120),
    left(nullif(trim(p_procedure_interest), ''), 200), left(nullif(trim(p_message), ''), 4000),
    v_assignee, case when v_assignee is not null then now() end, p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  perform public.log_lead_activity(v_id, 'system',
    case when v_partner is null then 'Enquiry added manually' else 'Referral enquiry added' end);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_RECEIVED', 'lead', v_id,
    jsonb_build_object('source', case when v_partner is null then 'manual' else 'referral' end,
      'assigned_to', v_assignee, 'referral_partner_id', v_partner));
  return v_id;
end $$;

-- Admin attaches, changes or clears a lead's referral partner.
create or replace function public.set_lead_referral_partner(p_lead_id uuid, p_partner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads%rowtype;
  v_partner_name text;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found.' using errcode = '22023';
  end if;
  if p_partner_id is not null then
    select name into v_partner_name from public.referral_partners where id = p_partner_id and active;
    if v_partner_name is null then
      raise exception 'Choose an active referral partner.' using errcode = '22023';
    end if;
  end if;
  if v_lead.referral_partner_id is not distinct from p_partner_id then return; end if;
  if v_lead.status = 'converted' and exists (
    select 1 from public.lead_packages where lead_id = p_lead_id and payout_status = 'paid'
  ) then
    raise exception 'The incentive for this lead is already paid.' using errcode = '22023';
  end if;

  update public.leads set
    referral_partner_id = p_partner_id,
    -- Meta stays Meta (the partner is extra context); a manual enquiry
    -- becomes a referral and back.
    source = case when source = 'meta' then 'meta'
                  when p_partner_id is null then 'manual' else 'referral' end
  where id = p_lead_id;

  perform public.log_lead_activity(p_lead_id, 'system',
    case when p_partner_id is null then 'Referral partner removed'
         else 'Referred by ' || v_partner_name end);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'LEAD_REFERRAL_SET', 'lead', p_lead_id,
    jsonb_build_object('from', v_lead.referral_partner_id, 'to', p_partner_id));
end $$;

-- ---------------------------------------------------------------------------
-- Package & payout
-- ---------------------------------------------------------------------------

create or replace function public.save_lead_package(
  p_lead_id uuid, p_package_name text, p_package_value_paise bigint,
  p_incentive_bps integer, p_payout_status text, p_payout_reference text, p_notes text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads%rowtype;
  v_existing public.lead_packages%rowtype;
  v_paid_amount bigint;
  v_paid_at timestamptz;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_package_name, ''))) < 2 then
    raise exception 'Enter the procedure or package.' using errcode = '22023';
  end if;
  if p_package_value_paise is null or p_package_value_paise < 0 then
    raise exception 'Enter a valid package value.' using errcode = '22023';
  end if;
  if p_incentive_bps is null or p_incentive_bps not between 0 and 10000 then
    raise exception 'Incentive must be between 0 and 100 percent.' using errcode = '22023';
  end if;
  if p_payout_status not in ('pending', 'paid', 'not_eligible') then
    raise exception 'Choose a payout status.' using errcode = '22023';
  end if;
  if p_payout_status = 'paid' and (v_lead.status <> 'converted' or v_lead.referral_partner_id is null) then
    raise exception 'Only a converted referral can be marked paid.' using errcode = '22023';
  end if;

  select * into v_existing from public.lead_packages where lead_id = p_lead_id;
  if v_existing.payout_status = 'paid' and p_payout_status = 'paid'
     and (v_existing.package_value_paise <> p_package_value_paise or v_existing.incentive_bps <> p_incentive_bps) then
    raise exception 'Reopen the payout (set it to pending) before changing a paid incentive.' using errcode = '22023';
  end if;

  if p_payout_status = 'paid' then
    if v_existing.payout_status = 'paid' then
      v_paid_amount := v_existing.paid_amount_paise;
      v_paid_at := v_existing.paid_at;
    else
      v_paid_amount := public.referral_incentive_paise(
        public.patient_collected_since(v_lead.patient_id, v_lead.converted_at),
        p_package_value_paise, p_incentive_bps);
      v_paid_at := now();
    end if;
  end if;

  insert into public.lead_packages as pkg (
    lead_id, package_name, package_value_paise, incentive_bps, payout_status,
    paid_amount_paise, paid_at, payout_reference, notes, updated_by
  ) values (
    p_lead_id, left(btrim(p_package_name), 200), p_package_value_paise, p_incentive_bps, p_payout_status,
    v_paid_amount, v_paid_at, left(nullif(btrim(p_payout_reference), ''), 200),
    left(nullif(btrim(p_notes), ''), 1000), auth.uid()
  )
  on conflict (lead_id) do update set
    package_name = excluded.package_name, package_value_paise = excluded.package_value_paise,
    incentive_bps = excluded.incentive_bps, payout_status = excluded.payout_status,
    paid_amount_paise = excluded.paid_amount_paise, paid_at = excluded.paid_at,
    payout_reference = excluded.payout_reference, notes = excluded.notes, updated_by = auth.uid();

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(),
    case when p_payout_status = 'paid' and v_existing.payout_status is distinct from 'paid'
         then 'REFERRAL_INCENTIVE_PAID' else 'LEAD_PACKAGE_SAVED' end,
    'lead', p_lead_id,
    jsonb_build_object('payout_status', p_payout_status, 'incentive_bps', p_incentive_bps,
      'paid_amount_paise', v_paid_amount));
end $$;

-- ---------------------------------------------------------------------------
-- Report: one row per booked/converted lead, or any lead with a partner.
-- Totals are over the whole filtered set (window sums), not just the page.
-- ---------------------------------------------------------------------------

create or replace function public.report_referral_conversions(
  p_from date, p_to date, p_source text default null, p_partner_id uuid default null,
  p_status text default null, p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns table (
  lead_id uuid, lead_name text, lead_phone text, patient_id uuid, patient_uhid text,
  source text, partner_id uuid, partner_name text, consultation_at timestamptz,
  package_name text, package_value_paise bigint, collected_paise bigint, converted_at timestamptz,
  incentive_bps integer, incentive_paise bigint, lead_status text, payout_status text,
  paid_at timestamptz, payout_reference text, package_notes text, report_status text,
  total_count bigint, total_package_paise bigint, total_collected_paise bigint,
  total_incentive_due_paise bigint, total_incentive_paid_paise bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
  with base as (
    select l.id, l.full_name, coalesce(l.phone_normalized, l.phone_raw) as phone, l.patient_id,
      pt.uhid, l.source, l.referral_partner_id, rp.name as partner_name,
      coalesce(cv.created_at, l.appointment_at) as consultation_at,
      coalesce(pkg.package_name, l.procedure_interest) as package_name,
      pkg.package_value_paise,
      case when l.status = 'converted' then public.patient_collected_since(l.patient_id, l.converted_at) end as collected,
      l.converted_at,
      case when l.referral_partner_id is not null then coalesce(pkg.incentive_bps, rp.default_incentive_bps) end as bps,
      l.status as lead_status, pkg.payout_status, pkg.paid_amount_paise, pkg.paid_at,
      pkg.payout_reference, pkg.notes,
      (pkg.lead_id is not null) as has_package
    from public.leads l
    left join public.patients pt on pt.id = l.patient_id
    left join public.referral_partners rp on rp.id = l.referral_partner_id
    left join public.visits cv on cv.id = l.converted_visit_id
    left join public.lead_packages pkg on pkg.lead_id = l.id
    where (l.status in ('booked', 'converted') or l.referral_partner_id is not null)
      and (coalesce(l.converted_at, l.appointment_at, l.received_at) at time zone 'Asia/Kolkata')::date
          between p_from and p_to
      and (p_source is null or l.source = p_source)
      and (p_partner_id is null or l.referral_partner_id = p_partner_id)
      and (v_q = '' or l.name_search like v_q || '%' or l.phone_normalized like v_q || '%'
           or lower(pt.uhid) like v_q || '%' or lower(rp.name) like v_q || '%')
  ), scored as (
    select b.*,
      case
        when b.referral_partner_id is null or not b.has_package or b.lead_status <> 'converted' then null
        when b.payout_status = 'paid' then b.paid_amount_paise
        when b.payout_status = 'not_eligible' then 0::bigint
        else public.referral_incentive_paise(b.collected, b.package_value_paise, b.bps)
      end as incentive,
      case
        when b.lead_status <> 'converted' then b.lead_status
        when b.referral_partner_id is null then 'converted'
        when b.payout_status = 'paid' then 'incentive_paid'
        when b.payout_status = 'not_eligible' then 'not_eligible'
        when not b.has_package then 'package_pending'
        when public.referral_incentive_paise(b.collected, b.package_value_paise, b.bps) > 0 then 'incentive_due'
        else 'awaiting_payment'
      end as status_label
    from base b
  ), filtered as (
    select s.* from scored s where p_status is null or s.status_label = p_status
  )
  select f.id, f.full_name, f.phone, f.patient_id, f.uhid, f.source, f.referral_partner_id,
    f.partner_name, f.consultation_at, f.package_name, f.package_value_paise, f.collected,
    f.converted_at, f.bps, f.incentive, f.lead_status, f.payout_status, f.paid_at,
    f.payout_reference, f.notes, f.status_label,
    count(*) over (),
    coalesce(sum(f.package_value_paise) over (), 0)::bigint,
    coalesce(sum(f.collected) over (), 0)::bigint,
    coalesce(sum(f.incentive) filter (where f.status_label = 'incentive_due') over (), 0)::bigint,
    coalesce(sum(f.incentive) filter (where f.status_label = 'incentive_paid') over (), 0)::bigint
  from filtered f
  order by coalesce(f.converted_at, f.consultation_at) desc nulls last, f.id
  limit least(greatest(coalesce(p_limit, 25), 1), 5000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Referral leads were labelled "Meta (unmapped form)" in the lead report.
do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.report_leads(date,date)'::regprocedure);
  patched := replace(definition,
    'case when source = ''manual'' then ''Manual enquiry'' else ''Meta (unmapped form)'' end',
    'case source when ''manual'' then ''Manual enquiry'' when ''referral'' then ''Referral'' else ''Meta (unmapped form)'' end');
  if patched = definition then
    raise exception 'report_leads source label not found';
  end if;
  execute patched;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; internal helpers not callable by staff.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.patient_collected_since(uuid, timestamptz),
  public.referral_incentive_paise(bigint, bigint, integer),
  public.save_referral_partner(uuid, text, text, text, integer, text, boolean),
  public.list_referral_partner_options(),
  public.create_manual_lead(text, text, text, text, text, text, uuid, uuid, uuid),
  public.set_lead_referral_partner(uuid, uuid),
  public.save_lead_package(uuid, text, bigint, integer, text, text, text),
  public.report_referral_conversions(date, date, text, uuid, text, text, integer, integer)
from public, anon;
revoke execute on function public.patient_collected_since(uuid, timestamptz) from authenticated;
grant execute on function
  public.referral_incentive_paise(bigint, bigint, integer),
  public.save_referral_partner(uuid, text, text, text, integer, text, boolean),
  public.list_referral_partner_options(),
  public.create_manual_lead(text, text, text, text, text, text, uuid, uuid, uuid),
  public.set_lead_referral_partner(uuid, uuid),
  public.save_lead_package(uuid, text, bigint, integer, text, text, text),
  public.report_referral_conversions(date, date, text, uuid, text, text, integer, integer)
to authenticated;
