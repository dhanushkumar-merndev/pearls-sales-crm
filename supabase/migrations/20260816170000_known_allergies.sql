-- Allergies are recorded as free text on the patient, which means the same
-- allergy gets typed a dozen slightly different ways ("penicillin", "Penicilin",
-- "PENICILLIN allergy"). Reception cannot pick from what the hospital has
-- already recorded, so the spelling drifts and a doctor scanning the history
-- can miss one.
--
-- This returns the allergies already in use across the register, most common
-- first, so the entry field can offer them as one-tap chips. Free text is still
-- allowed: an allergy nobody has recorded yet must never be blocked.
begin;

create or replace function public.list_known_allergies(
  p_query text default null,
  p_limit integer default 20
)
returns table(allergy text, patient_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role; v_query text;
begin
  v_role := public.current_app_role();
  -- Same roles that may read a patient record at all.
  if v_role is null or v_role not in ('admin','reception','op','doctor','ip') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := lower(trim(coalesce(p_query,'')));

  return query
  with entries as (
    -- One row per allergy per patient: the column holds a comma or newline
    -- separated list.
    select btrim(regexp_replace(value, '\s+', ' ', 'g')) as label
    from public.patients p,
         lateral regexp_split_to_table(coalesce(p.allergies, ''), '[,;\n]') as value
    where p.status = 'active'
  ),
  cleaned as (
    select label, lower(label) as key
    from entries
    where length(label) between 2 and 80
  )
  select
    -- The most frequently used spelling wins as the display label.
    (array_agg(c.label order by c.label))[1] as allergy,
    count(*) as patient_count
  from cleaned c
  where v_query = '' or c.key like v_query || '%' or c.key like '% ' || v_query || '%'
  group by c.key
  order by count(*) desc, 1
  limit least(greatest(p_limit, 1), 50);
end $$;

revoke all on function public.list_known_allergies(text,integer) from public, anon;
grant execute on function public.list_known_allergies(text,integer) to authenticated, service_role;

commit;
