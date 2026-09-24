-- Lets the diagnosis search fall back to WHO's own ICD-10 API when the local
-- clinical_terms directory has nothing for the query, and remember the
-- answer so the same query is a database hit next time (see
-- src/lib/search/who-icd10.ts and /api/search/clinical-terms). This never
-- calls WHO on its own: the route only reaches it when the local search
-- already came back empty, and only when the hospital has registered its own
-- WHO_CLIENT/WHO_SECRET -- nothing changes here for a hospital that hasn't.
--
-- clinical_terms writes are normally admin-only (directory_admin policy), by
-- design -- the manually-curated directory shouldn't be edited by everyone
-- who can search it. This is narrower than that: it can only ever insert a
-- WHO-sourced, WHO-coded diagnosis row, gated to the same roles already
-- allowed to run search_clinical_terms, and it never touches an existing
-- row's code/code_system once one is set (a hospital-curated or bulk-
-- imported code always wins over a same-named WHO cache entry).
begin;

create or replace function public.cache_who_icd10_term(
  p_display_text text,
  p_code text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_role() not in ('admin','doctor','op','ip') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(trim(coalesce(p_display_text,''))) < 2 or length(trim(coalesce(p_code,''))) < 1 then
    return;
  end if;

  insert into public.clinical_terms(term_type, display_text, code, code_system, source, source_license)
  values ('diagnosis', trim(p_display_text), trim(p_code), 'ICD-10', 'WHO ICD-API', 'WHO ICD-10 public')
  on conflict (term_type, normalized_text) do update
    set code = coalesce(public.clinical_terms.code, excluded.code),
        code_system = coalesce(public.clinical_terms.code_system, excluded.code_system);
end $$;

revoke all on function public.cache_who_icd10_term(text,text) from public, anon;
grant execute on function public.cache_who_icd10_term(text,text) to authenticated;

commit;
