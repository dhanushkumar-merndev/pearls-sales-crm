begin;
create function public.search_medicine_availability(p_query text,p_limit integer default 20)
returns table(id uuid,brand_name text,generic_name text,strength text,dosage_form text,quantity bigint,low_stock_threshold bigint)
language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','doctor','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select m.id,m.brand_name,m.generic_name,m.strength,m.dosage_form,coalesce(sum(b.quantity) filter(where b.active and b.expiry_date>=current_date),0)::bigint,coalesce(sum(b.low_stock_threshold) filter(where b.active),0)::bigint from public.medicine_directory m left join public.medicine_batches b on b.medicine_id=m.id where m.active and m.search_text like lower(trim(p_query))||'%' group by m.id order by case when lower(m.brand_name)=lower(trim(p_query)) then 0 else 1 end,m.brand_name limit least(greatest(p_limit,1),25);
end $$;

create function public.list_pharmacy_batches(p_limit integer default 50,p_offset integer default 0)
returns table(id uuid,medicine_id uuid,batch_number text,expiry_date date,quantity integer,purchase_price_paise bigint,selling_price_paise bigint,low_stock_threshold integer,active boolean,brand_name text,generic_name text,strength text,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.id,b.medicine_id,b.batch_number,b.expiry_date,b.quantity,b.purchase_price_paise,b.selling_price_paise,b.low_stock_threshold,b.active,m.brand_name,m.generic_name,m.strength,count(*) over() from public.medicine_batches b join public.medicine_directory m on m.id=b.medicine_id order by b.expiry_date,b.batch_number limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;

create function public.list_medicine_directory(p_query text,p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,brand_name text,generic_name text,strength text,dosage_form text,manufacturer text,active boolean,available_quantity bigint,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select m.id,m.brand_name,m.generic_name,m.strength,m.dosage_form,m.manufacturer,m.active,coalesce(sum(b.quantity) filter(where b.active and b.expiry_date>=current_date),0)::bigint,count(*) over() from public.medicine_directory m left join public.medicine_batches b on b.medicine_id=m.id where nullif(trim(p_query),'') is null or m.search_text like '%'||lower(trim(p_query))||'%' group by m.id order by m.brand_name limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;

create function public.list_available_dispense_batches(p_limit integer default 500)
returns table(id uuid,medicine_id uuid,batch_number text,expiry_date date,quantity integer,selling_price_paise bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.id,b.medicine_id,b.batch_number,b.expiry_date,b.quantity,b.selling_price_paise from public.medicine_batches b where b.active and b.quantity>0 and b.expiry_date>=current_date order by b.expiry_date limit least(greatest(p_limit,1),500);
end $$;

revoke all on function public.search_medicine_availability(text,integer) from public;
revoke all on function public.list_pharmacy_batches(integer,integer) from public;
revoke all on function public.list_medicine_directory(text,integer,integer) from public;
revoke all on function public.list_available_dispense_batches(integer) from public;
grant execute on function public.search_medicine_availability(text,integer) to authenticated;
grant execute on function public.list_pharmacy_batches(integer,integer) to authenticated;
grant execute on function public.list_medicine_directory(text,integer,integer) to authenticated;
grant execute on function public.list_available_dispense_batches(integer) to authenticated;

-- Price and supplier-cost columns are no longer queryable through the base
-- table by any browser session. Pharmacy/admin reads use the guarded RPC.
revoke select on public.medicine_batches from authenticated;
commit;
