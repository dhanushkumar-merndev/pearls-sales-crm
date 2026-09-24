-- IP staff can now search live medicine stock while typing an item request
-- (autocomplete with availability, same as the doctor's prescription
-- search) instead of only free text. They could already ask pharmacy for
-- items; this just lets them see what's actually in stock while typing --
-- pharmacy still owns fulfilment and still prices/matches at that step.
-- Typing something not in the list remains fully supported.
begin;

create or replace function public.search_medicine_availability(p_query text, p_limit integer default 20)
returns table(id uuid, brand_name text, generic_name text, strength text, dosage_form text, quantity bigint, low_stock_threshold bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role; v_query text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','doctor','pharmacy','ip') then raise exception 'forbidden' using errcode='42501'; end if;
  v_query := lower(trim(p_query));
  if v_query = '' then return; end if;
  return query
  select m.id, m.brand_name, m.generic_name, m.strength, m.dosage_form,
         coalesce(sum(b.quantity) filter(where b.active and b.expiry_date >= current_date), 0)::bigint,
         coalesce(sum(b.low_stock_threshold) filter(where b.active), 0)::bigint
  from public.medicine_directory m
  left join public.medicine_batches b on b.medicine_id = m.id
  where m.active
    and (m.search_text like v_query || '%' or m.search_text like '% ' || v_query || '%')
  group by m.id
  order by
    case
      when lower(m.brand_name) = v_query then 0
      when m.search_text like v_query || '%' then 1
      when lower(coalesce(m.generic_name,'')) like v_query || '%' then 2
      else 3
    end,
    m.brand_name
  limit least(greatest(p_limit,1),25);
end $$;

revoke all on function public.search_medicine_availability(text, integer) from public;
grant execute on function public.search_medicine_availability(text, integer) to authenticated;

commit;
