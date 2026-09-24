-- Official SNOMED CT RF2 terminology is kept separate from the hospital's
-- editable clinical_terms directory. A SNOMED concept ID and an ICD-10 code
-- can legitimately share the same display text, while clinical_terms has one
-- unique row per normalized phrase. Keeping the licensed release here avoids
-- either classification overwriting the other.
begin;

create table public.snomed_releases (
  id uuid primary key default gen_random_uuid(),
  edition text not null,
  effective_date date not null,
  source_package text not null,
  license_statement text not null,
  source_concept_count integer not null default 0 check (source_concept_count >= 0),
  source_description_count integer not null default 0 check (source_description_count >= 0),
  loaded_concept_count integer not null default 0 check (loaded_concept_count >= 0),
  loaded_description_count integer not null default 0 check (loaded_description_count >= 0),
  status text not null default 'importing' check (status in ('importing', 'ready', 'failed')),
  is_current boolean not null default false,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (edition, effective_date)
);

create unique index snomed_releases_one_current_idx
on public.snomed_releases(is_current)
where is_current;

create table public.snomed_concepts (
  -- SNOMED identifiers are numeric strings, not application UUIDs. Text keeps
  -- every digit exact in JavaScript as well as PostgreSQL.
  concept_id text primary key check (concept_id ~ '^[0-9]+$'),
  release_id uuid not null references public.snomed_releases(id) on delete restrict,
  effective_date date not null,
  module_id text not null check (module_id ~ '^[0-9]+$'),
  definition_status_id text not null check (definition_status_id ~ '^[0-9]+$'),
  active boolean not null default true,
  preferred_term text not null check (length(btrim(preferred_term)) > 0),
  fully_specified_name text not null check (length(btrim(fully_specified_name)) > 0),
  semantic_tag text,
  synonyms text[] not null default '{}',
  -- Populated by the importer so the generated tsvector can use only immutable
  -- functions. It contains the preferred term, FSN and all active synonyms.
  search_text text not null,
  normalized_preferred text generated always as (
    lower(regexp_replace(btrim(preferred_term), '\s+', ' ', 'g'))
  ) stored,
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, search_text)
  ) stored,
  is_clinical_finding boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index snomed_concepts_code_prefix_idx
on public.snomed_concepts(concept_id text_pattern_ops)
where active and is_clinical_finding;

create index snomed_concepts_preferred_prefix_idx
on public.snomed_concepts(normalized_preferred text_pattern_ops)
where active and is_clinical_finding;

create index snomed_concepts_search_idx
on public.snomed_concepts using gin(search_vector)
where active and is_clinical_finding;

alter table public.snomed_releases enable row level security;
alter table public.snomed_concepts enable row level security;

create policy snomed_releases_admin_read
on public.snomed_releases for select to authenticated
using (public.current_app_role() = 'admin');

create policy snomed_concepts_admin_read
on public.snomed_concepts for select to authenticated
using (public.current_app_role() = 'admin');

-- Supabase grants new public-schema tables broadly by default. RLS would still
-- reject these operations, but production uses least privilege at both layers.
revoke all on public.snomed_releases, public.snomed_concepts
from public, anon, authenticated;
grant select on public.snomed_releases, public.snomed_concepts to authenticated;

-- Search official SNOMED clinical findings alongside the hospital's legacy
-- SNOMED-ready shortlist. Official RF2 results do not have a clinical_terms
-- UUID, so id is null; consultation_diagnoses already snapshots the selected
-- display text, concept ID and code system and permits a null term_id.
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
  v_tsquery_text text;
  v_tsquery tsquery;
begin
  if public.current_app_role() not in ('admin', 'doctor', 'pharmacy') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code_system not in ('ICD-10', 'SNOMED-CT') then
    raise exception 'unknown code system' using errcode = '22023';
  end if;

  v_query := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  if length(v_query) < 2 then return; end if;

  select string_agg(quote_literal(token) || ':*', ' & ')
  into v_tsquery_text
  from regexp_split_to_table(v_query, '[^[:alnum:]]+') token
  where token <> '';
  if v_tsquery_text is not null then
    v_tsquery := to_tsquery('simple'::regconfig, v_tsquery_text);
  end if;

  return query
  with official as (
    select
      null::uuid as id,
      concept.preferred_term as display_text,
      concept.concept_id as code,
      'SNOMED-CT'::text as code_system,
      'SNOMED CT International Edition'::text as source,
      true as mapped,
      case
        when concept.normalized_preferred = v_query then 0
        when exists (
          select 1 from unnest(concept.synonyms) synonym
          where lower(synonym) = v_query
        ) then 1
        when concept.concept_id = v_query then 2
        when concept.normalized_preferred like v_query || '%' then 3
        when concept.concept_id like v_query || '%' then 4
        else 5
      end as match_rank,
      case when v_tsquery is null then 0::real
           else ts_rank(concept.search_vector, v_tsquery) end as text_rank,
      0 as source_rank
    from public.snomed_concepts concept
    where p_code_system = 'SNOMED-CT'
      and concept.active
      and concept.is_clinical_finding
      and (
        concept.concept_id like v_query || '%'
        or concept.normalized_preferred like v_query || '%'
        or (v_tsquery is not null and concept.search_vector @@ v_tsquery)
      )
    order by match_rank, text_rank desc, concept.preferred_term
    limit least(greatest(coalesce(p_limit, 20), 1), 25)
  ),
  local_directory as (
    select
      term.id,
      term.display_text,
      case when term.code_system = p_code_system then term.code else null end as code,
      case when term.code_system = p_code_system then term.code_system else null end as code_system,
      term.source,
      (term.code is not null and term.code_system = p_code_system) as mapped,
      case
        when term.normalized_text = v_query then 0
        when term.code_system = p_code_system
          and lower(coalesce(term.code, '')) = v_query then 1
        when term.normalized_text like v_query || '%' then 2
        when lower(coalesce(term.code, '')) like v_query || '%' then 3
        else 4
      end as match_rank,
      0::real as text_rank,
      case when p_code_system = 'ICD-10' then 0 else 1 end as source_rank
    from public.clinical_terms term
    where term.active
      and term.term_type = 'diagnosis'
      and (
        term.code_system = p_code_system
        or (
          p_code_system = 'SNOMED-CT'
          and (
            term.source = 'hospital'
            or exists (
              select 1
              from public.clinical_term_catalog_memberships membership
              where membership.term_id = term.id
                and membership.catalog = 'SNOMED-ready common diagnosis dataset'
            )
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
    order by match_rank, term.display_text
    limit least(greatest(coalesce(p_limit, 20), 1), 25)
  ),
  ranked as (
    select candidate.*,
      row_number() over (
        partition by lower(candidate.display_text)
        order by candidate.source_rank, candidate.match_rank,
                 candidate.text_rank desc, candidate.display_text
      ) as duplicate_rank
    from (
      select * from official
      union all
      select * from local_directory
    ) candidate
  )
  select ranked.id, ranked.display_text, ranked.code, ranked.code_system,
         ranked.source, ranked.mapped
  from ranked
  where ranked.duplicate_rank = 1
  order by ranked.source_rank, ranked.match_rank,
           ranked.text_rank desc, ranked.display_text
  limit least(greatest(coalesce(p_limit, 20), 1), 25);
end;
$$;

revoke all on function public.search_diagnosis_terms(text, text, integer)
from public, anon;
grant execute on function public.search_diagnosis_terms(text, text, integer)
to authenticated, service_role;

commit;
