-- A diagnosis can be both an ICD-coded clinical term and a member of the
-- hospital's SNOMED-ready catalog. When it is found from the SNOMED-ready tab,
-- do not project its unrelated ICD code as though it were a SNOMED concept ID.
begin;

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
    case when term.code_system = p_code_system then term.code else null end,
    case when term.code_system = p_code_system then term.code_system else null end,
    term.source,
    (term.code is not null and term.code_system = p_code_system)
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
      when term.code_system = p_code_system
        and lower(coalesce(term.code, '')) = v_query then 1
      when term.normalized_text like v_query || '%' then 2
      when exists (
        select 1
        from unnest(term.search_aliases) alias
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

commit;
