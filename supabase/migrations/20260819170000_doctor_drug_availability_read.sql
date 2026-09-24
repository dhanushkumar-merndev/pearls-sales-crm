-- Doctors currently prescribe blind to what the pharmacy actually has in
-- stock -- list_medicine_directory (the read behind Medicine Master) is
-- gated to admin/pharmacy only, and there was no doctor-facing screen for it
-- anyway. Widen the gate so a consultant can check availability before
-- writing a prescription; the function already returns nothing sensitive
-- (no purchase price, no batch/supplier detail -- just name, form and a
-- summed available quantity), so this is a pure read widening, not a new
-- data exposure.
begin;

create or replace function public.list_medicine_directory(p_query text,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,brand_name text,generic_name text,strength text,dosage_form text,manufacturer text,active boolean,available_quantity bigint,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('admin','pharmacy','doctor','op') then raise exception 'forbidden' using errcode='42501';end if;
 return query select m.id,m.brand_name,m.generic_name,m.strength,m.dosage_form,m.manufacturer,m.active,coalesce(sum(b.quantity) filter(where b.active and b.expiry_date>=current_date),0)::bigint,count(*) over() from public.medicine_directory m left join public.medicine_batches b on b.medicine_id=m.id where nullif(trim(p_query),'') is null or m.search_text like '%'||lower(trim(p_query))||'%' group by m.id order by m.brand_name limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;

commit;
