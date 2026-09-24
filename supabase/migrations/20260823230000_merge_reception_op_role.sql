-- Reception now owns both registration/billing and the former OP-desk
-- workflow. Keep the app_role enum value for historical database compatibility,
-- but migrate every actual OP profile so no separate OP login is needed.
begin;

insert into public.audit_logs(action, entity_type, entity_id, metadata)
select
  'USER_ROLE_MERGED',
  'profile',
  profile.id,
  jsonb_build_object(
    'from_role', 'op',
    'to_role', 'reception',
    'reason', 'Reception and OP workspaces merged'
  )
from public.profiles profile
where profile.role = 'op';

-- Authentication metadata is not used for authorization (profiles.role is),
-- but keep it consistent so support/admin tooling never shows the old role.
update auth.users auth_user
set raw_user_meta_data = jsonb_set(
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"reception"'::jsonb,
  true
)
from public.profiles profile
where profile.id = auth_user.id
  and profile.role = 'op';

update public.profiles
set role = 'reception'
where role = 'op';

-- The server action uses this RPC, and the direct table policy remains aligned
-- so neither path treats the UI permission as the security boundary.
drop policy if exists vitals_write on public.vitals;
create policy vitals_write on public.vitals
for all to authenticated
using (
  public.current_app_role() in ('admin', 'reception', 'op')
  or (
    public.current_app_role() = 'doctor'
    and exists (
      select 1 from public.visits visit
      where visit.id = vitals.visit_id
        and visit.doctor_id = public.current_doctor_id()
    )
  )
)
with check (
  public.current_app_role() in ('admin', 'reception', 'op')
  or (
    public.current_app_role() = 'doctor'
    and exists (
      select 1 from public.visits visit
      where visit.id = vitals.visit_id
        and visit.doctor_id = public.current_doctor_id()
    )
  )
);

create or replace function public.record_visit_vitals(
  p_visit_id uuid,
  p_weight_kg numeric,
  p_height_cm numeric,
  p_temperature_f numeric,
  p_bp_systolic smallint,
  p_bp_diastolic smallint,
  p_pulse smallint,
  p_spo2 smallint,
  p_respiratory_rate smallint,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_id uuid;
  v_doctor uuid;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();

  if v_role is null or v_role not in ('admin', 'reception', 'op', 'doctor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.visits
    where id = p_visit_id
      and status not in ('completed', 'cancelled')
      and (v_role <> 'doctor' or doctor_id = v_doctor)
  ) then
    raise exception 'visit unavailable' using errcode = '42501';
  end if;

  insert into public.vitals (
    visit_id, weight_kg, height_cm, temperature_f, bp_systolic,
    bp_diastolic, pulse, spo2, respiratory_rate, notes
  )
  values (
    p_visit_id, p_weight_kg, p_height_cm, p_temperature_f, p_bp_systolic,
    p_bp_diastolic, p_pulse, p_spo2, p_respiratory_rate, p_notes
  )
  on conflict (visit_id) do update set
    weight_kg = excluded.weight_kg,
    height_cm = excluded.height_cm,
    temperature_f = excluded.temperature_f,
    bp_systolic = excluded.bp_systolic,
    bp_diastolic = excluded.bp_diastolic,
    pulse = excluded.pulse,
    spo2 = excluded.spo2,
    respiratory_rate = excluded.respiratory_rate,
    notes = excluded.notes,
    recorded_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  update public.visits set status = 'ready' where id = p_visit_id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
  values (auth.uid(), 'VITALS_RECORDED', 'visit', p_visit_id);

  return v_id;
end;
$$;

revoke all on function public.record_visit_vitals(
  uuid, numeric, numeric, numeric, smallint, smallint, smallint, smallint,
  smallint, text
) from public, anon;
grant execute on function public.record_visit_vitals(
  uuid, numeric, numeric, numeric, smallint, smallint, smallint, smallint,
  smallint, text
) to authenticated, service_role;

-- Read-only availability used by the former OP workspace. No purchase price,
-- supplier cost, batch metadata, or stock-management write is exposed.
create or replace function public.list_medicine_directory(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  id uuid,
  brand_name text,
  generic_name text,
  strength text,
  dosage_form text,
  manufacturer text,
  active boolean,
  available_quantity bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() not in (
    'admin', 'reception', 'pharmacy', 'doctor', 'op', 'ip'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength,
    medicine.dosage_form,
    medicine.manufacturer,
    medicine.active,
    coalesce(sum(batch.quantity) filter (
      where batch.active and batch.expiry_date >= current_date
    ), 0)::bigint,
    count(*) over()
  from public.medicine_directory medicine
  left join public.medicine_batches batch on batch.medicine_id = medicine.id
  where nullif(trim(p_query), '') is null
     or medicine.search_text like '%' || lower(trim(p_query)) || '%'
  group by medicine.id
  order by medicine.brand_name
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.list_medicine_directory(text, integer, integer)
from public, anon;
grant execute on function public.list_medicine_directory(text, integer, integer)
to authenticated, service_role;

create or replace function public.search_medicine_availability(
  p_query text,
  p_limit integer default 20
)
returns table(
  id uuid,
  brand_name text,
  generic_name text,
  strength text,
  dosage_form text,
  quantity bigint,
  low_stock_threshold bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in (
    'admin', 'reception', 'doctor', 'op', 'pharmacy', 'ip'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_query := lower(trim(p_query));
  if v_query = '' then return; end if;
  return query
  select
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength,
    medicine.dosage_form,
    coalesce(sum(batch.quantity) filter (
      where batch.active and batch.expiry_date >= current_date
    ), 0)::bigint,
    coalesce(sum(batch.low_stock_threshold) filter (
      where batch.active
    ), 0)::bigint
  from public.medicine_directory medicine
  left join public.medicine_batches batch on batch.medicine_id = medicine.id
  where medicine.active
    and (
      medicine.search_text like v_query || '%'
      or medicine.search_text like '% ' || v_query || '%'
    )
  group by medicine.id
  order by
    case
      when lower(medicine.brand_name) = v_query then 0
      when medicine.search_text like v_query || '%' then 1
      when lower(coalesce(medicine.generic_name, '')) like v_query || '%' then 2
      else 3
    end,
    medicine.brand_name
  limit least(greatest(p_limit, 1), 25);
end;
$$;

revoke all on function public.search_medicine_availability(text, integer)
from public, anon;
grant execute on function public.search_medicine_availability(text, integer)
to authenticated, service_role;

-- Preserve the existing guarded drill-down for every role, and add only the
-- former OP metrics to reception. Renaming avoids copying the pharmacy/IP
-- fulfilment detail logic and keeps its existing security checks intact.
alter function public.dashboard_metric_detail_for_role(text, integer)
rename to dashboard_metric_detail_for_role_before_reception_op_merge;

revoke all on function
  public.dashboard_metric_detail_for_role_before_reception_op_merge(text, integer)
from public, anon, authenticated;

create function public.dashboard_metric_detail_for_role(
  p_metric text,
  p_limit integer default 25
)
returns table(
  primary_text text,
  secondary_text text,
  trailing_text text,
  href text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() = 'reception'
     and p_metric = any(array[
       'patients_seen_today', 'vitals_pending', 'ready', 'completed',
       'reports_pending'
     ])
  then
    return query
    select detail.primary_text, detail.secondary_text, detail.trailing_text,
           detail.href
    from public.dashboard_metric_detail(
      p_metric,
      least(greatest(coalesce(p_limit, 25), 1), 100)
    ) detail;
    return;
  end if;

  return query
  select detail.primary_text, detail.secondary_text, detail.trailing_text,
         detail.href
  from public.dashboard_metric_detail_for_role_before_reception_op_merge(
    p_metric,
    p_limit
  ) detail;
end;
$$;

revoke all on function public.dashboard_metric_detail_for_role(text, integer)
from public, anon;
grant execute on function public.dashboard_metric_detail_for_role(text, integer)
to authenticated, service_role;

commit;
