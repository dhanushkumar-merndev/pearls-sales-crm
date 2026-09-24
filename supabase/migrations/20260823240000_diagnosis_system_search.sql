-- Filter diagnosis code systems in PostgreSQL before LIMIT. The client used
-- to request 20 mixed ICD/SNOMED rows and filter afterwards, so common ICD
-- matches could consume the whole result and make the SNOMED tab look empty.
begin;

-- A term may already carry an ICD-10 code and also occur in the supplied
-- SNOMED-ready catalog. Keep that provenance separately instead of replacing
-- the verified ICD code or duplicating the diagnosis text.
create table if not exists public.clinical_term_catalog_memberships (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.clinical_terms(id) on delete cascade,
  catalog text not null,
  source_reference text not null,
  specialty text,
  concept_class text,
  mapping_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (term_id, catalog),
  unique (catalog, source_reference)
);

alter table public.clinical_term_catalog_memberships enable row level security;
create policy clinical_term_catalog_admin_read
on public.clinical_term_catalog_memberships
for select to authenticated
using (public.current_app_role() = 'admin');

create index if not exists clinical_term_catalog_memberships_term_idx
on public.clinical_term_catalog_memberships(term_id, catalog);

create or replace function public.search_diagnosis_terms(
  p_query text,
  p_code_system text,
  p_limit integer default 20
)
returns table(
  id uuid,
  display_text text,
  code text,
  code_system text,
  source text,
  mapped boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text;
begin
  if public.current_app_role() not in ('admin', 'doctor', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code_system not in ('ICD-10', 'SNOMED-CT') then
    raise exception 'unknown code system' using errcode = '22023';
  end if;

  v_query := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  if length(v_query) < 2 then return; end if;

  return query
  select
    term.id,
    term.display_text,
    term.code,
    term.code_system,
    term.source,
    (term.code is not null and term.code_system = p_code_system) as mapped
  from public.clinical_terms term
  where term.active
    and term.term_type = 'diagnosis'
    and (
      term.code_system = p_code_system
      or (
        p_code_system = 'SNOMED-CT'
        and exists (
          select 1
          from public.clinical_term_catalog_memberships membership
          where membership.term_id = term.id
            and membership.catalog = 'SNOMED-ready common diagnosis dataset'
        )
      )
    )
    and (
      term.normalized_text like v_query || '%'
      or term.normalized_text like '% ' || v_query || '%'
      or lower(coalesce(term.code, '')) like v_query || '%'
      or exists (
        select 1
        from unnest(term.search_aliases) alias
        where lower(alias) like v_query || '%'
           or lower(alias) like '% ' || v_query || '%'
      )
    )
  order by
    case
      when term.normalized_text = v_query then 0
      when lower(coalesce(term.code, '')) = v_query then 1
      when term.normalized_text like v_query || '%' then 2
      when exists (
        select 1 from unnest(term.search_aliases) alias
        where lower(alias) = v_query
      ) then 3
      else 4
    end,
    term.display_text
  limit least(greatest(coalesce(p_limit, 20), 1), 25);
end;
$$;

revoke all on function public.search_diagnosis_terms(text, text, integer)
from public, anon;
grant execute on function public.search_diagnosis_terms(text, text, integer)
to authenticated, service_role;

-- The generic directory is non-patient reference data. Reception now owns the
-- former OP workflow, IP records investigations, and Pharmacy can transcribe a
-- consultation, so retain the old callers and add the two actual V1 roles.
create or replace function public.search_clinical_terms(
  p_term_type text,
  p_query text default null,
  p_limit integer default 20
)
returns table(
  id uuid,
  term_type text,
  display_text text,
  code text,
  code_system text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text;
begin
  if public.current_app_role() not in (
    'admin', 'reception', 'doctor', 'ip', 'pharmacy'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_query := nullif(lower(regexp_replace(
    trim(coalesce(p_query, '')), '\s+', ' ', 'g'
  )), '');

  return query
  select
    term.id,
    term.term_type,
    term.display_text,
    term.code,
    term.code_system
  from public.clinical_terms term
  where term.active
    and term.term_type = p_term_type
    and (
      v_query is null
      or term.normalized_text like v_query || '%'
      or term.normalized_text like '% ' || v_query || '%'
      or lower(coalesce(term.code, '')) like v_query || '%'
      or exists (
        select 1
        from unnest(term.search_aliases) alias
        where lower(alias) like v_query || '%'
      )
    )
  order by
    case when term.normalized_text like v_query || '%' then 0 else 1 end,
    term.display_text
  limit least(greatest(coalesce(p_limit, 20), 1), 25);
end;
$$;

revoke all on function public.search_clinical_terms(text, text, integer)
from public, anon;
grant execute on function public.search_clinical_terms(text, text, integer)
to authenticated, service_role;

-- Pharmacy staff can transcribe a consultant's paper prescription in the
-- existing workflow, so they need the same safe directory lookup and local
-- term remembering behavior while doing that work. This does not grant any
-- clinical-directory administration privilege.
create or replace function public.add_clinical_term(
  p_term_type text,
  p_display_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_text text;
  v_id uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin', 'doctor', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_term_type not in ('symptom', 'diagnosis', 'investigation', 'advice') then
    raise exception 'unknown term type' using errcode = '22023';
  end if;

  v_text := btrim(coalesce(p_display_text, ''));
  if length(v_text) < 2 or length(v_text) > 300 then
    raise exception 'invalid term' using errcode = '22023';
  end if;

  select term.id
  into v_id
  from public.clinical_terms term
  where term.term_type = p_term_type
    and term.normalized_text = lower(regexp_replace(v_text, '\s+', ' ', 'g'));

  if v_id is not null then return v_id; end if;

  insert into public.clinical_terms(
    term_type, display_text, source, source_version
  )
  values (
    p_term_type, v_text, 'hospital', 'entered-during-consultation'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_clinical_term(text, text) from public, anon;
grant execute on function public.add_clinical_term(text, text)
to authenticated, service_role;

commit;
