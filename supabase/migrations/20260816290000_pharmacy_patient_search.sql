-- The pharmacy counter's procedure billing (features/pharmacy/inventory-dialogs.tsx)
-- attaches a bill to a patient the same way reception or IP does, via the
-- shared PatientCombobox -> /api/search/patients -> list_patients(). Pharmacy
-- was missing from both the app-level `viewPatients` permission and this
-- RPC's own role gate, so the search always failed with "forbidden" and the
-- combobox showed "Patient search is temporarily unavailable." for pharmacy
-- staff no matter what they typed. Widen the gate to match; the returned
-- columns are identity-only (name/phone/UHID/dob/gender/status), no clinical
-- or financial data, consistent with AGENTS.md 46's "minimal" pharmacy access.
begin;

create or replace function public.list_patients(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_include_visit_count boolean default false,
  p_active_only boolean default false
)
returns table(
  id uuid,
  name text,
  uhid text,
  phone_normalized text,
  dob date,
  gender text,
  status text,
  created_at timestamptz,
  visit_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_query text;
  v_digits text;
  v_uhid_query text;
  v_limit integer;
  v_offset integer;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','reception','op','doctor','ip','pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  v_uhid_query := case
    when v_query ~ '^mh-?[0-9]+' then 'mh-' || v_digits
    else v_query
  end;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := least(greatest(coalesce(p_offset, 0), 0), 100000);

  return query
  with filtered as (
    select
      p.id,
      p.name,
      p.uhid,
      p.phone_normalized,
      p.dob,
      p.gender::text as gender,
      p.status::text as status,
      p.created_at,
      p.name_normalized,
      count(*) over () as total_count,
      case
        when v_query = '' then 0
        when lower(p.uhid) = v_uhid_query then 0
        when p.phone_normalized = right(v_digits, 10) then 0
        when p.phone_normalized like right(v_digits, 10) || '%' then 1
        when lower(p.uhid) like 'mh-' || v_digits || '%' then 2
        else 3
      end as relevance
    from public.patients p
    where
      (not p_active_only or p.status = 'active')
      and (
        v_query = ''
        or (
          v_query ~ '^mh-?[0-9]+'
          and lower(p.uhid) like v_uhid_query || '%'
        )
        or (
          v_query ~ '^[0-9+() -]+$'
          and v_digits <> ''
          and (
            p.phone_normalized like right(v_digits, 10) || '%'
            or lower(p.uhid) like 'mh-' || v_digits || '%'
          )
        )
        or (
          v_query !~ '^[0-9+() -]+$'
          and v_query !~ '^mh-?[0-9]+'
          and p.name_normalized like v_query || '%'
        )
      )
  ), paged as (
    select f.*
    from filtered f
    order by
      f.relevance,
      case when v_query = '' then f.created_at end desc,
      f.name_normalized,
      f.id
    limit v_limit
    offset v_offset
  )
  select
    p.id,
    p.name,
    p.uhid,
    p.phone_normalized,
    p.dob,
    p.gender,
    p.status,
    p.created_at,
    coalesce(v.visit_count, 0)::bigint,
    p.total_count
  from paged p
  left join lateral (
    select count(*)::bigint as visit_count
    from public.visits visit
    where p_include_visit_count and visit.patient_id = p.id
  ) v on true
  order by
    p.relevance,
    case when v_query = '' then p.created_at end desc,
    p.name_normalized,
    p.id;
end
$$;

revoke all on function public.list_patients(text, integer, integer, boolean, boolean) from public, anon;
grant execute on function public.list_patients(text, integer, integer, boolean, boolean) to authenticated, service_role;

commit;
