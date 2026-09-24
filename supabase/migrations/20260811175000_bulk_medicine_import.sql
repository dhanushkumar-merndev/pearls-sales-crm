begin;

alter table public.bulk_import_jobs add column idempotency_key uuid unique;
create unique index medicine_directory_normalized_identity_idx on public.medicine_directory(
  lower(regexp_replace(trim(brand_name),'\s+',' ','g')),
  lower(regexp_replace(trim(coalesce(generic_name,'')),'\s+',' ','g')),
  lower(regexp_replace(trim(coalesce(strength,'')),'\s+',' ','g')),
  lower(regexp_replace(trim(dosage_form),'\s+',' ','g'))
);

create function public.bulk_import_medicines(p_rows jsonb,p_file_name text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_job uuid;v_row jsonb;v_medicine uuid;v_batch uuid;v_created_medicines integer:=0;v_new_batches integer:=0;v_updated_batches integer:=0;v_row_count integer;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 v_row_count:=jsonb_array_length(p_rows);if v_row_count<1 or v_row_count>1000 then raise exception 'row count must be between 1 and 1000';end if;
 select id into v_job from public.bulk_import_jobs where idempotency_key=p_idempotency_key;
 if v_job is not null then return (select jsonb_build_object('job_id',id,'row_count',row_count,'success_count',success_count,'created_medicines',coalesce((select (metadata->>'created_medicines')::integer from public.audit_logs where entity_id=id and action='BULK_MEDICINE_IMPORT_COMPLETED' order by created_at desc limit 1),0)) from public.bulk_import_jobs where id=v_job);end if;
 insert into public.bulk_import_jobs(file_name,row_count,status,idempotency_key) values(left(p_file_name,255),v_row_count,'processing',p_idempotency_key) returning id into v_job;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  select id into v_medicine from public.medicine_directory where lower(regexp_replace(trim(brand_name),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'medicine_name'),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(generic_name,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'generic_name','')),'\s+',' ','g')) and lower(regexp_replace(trim(coalesce(strength,'')),'\s+',' ','g'))=lower(regexp_replace(trim(coalesce(v_row->>'strength','')),'\s+',' ','g')) and lower(regexp_replace(trim(dosage_form),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'dosage_form'),'\s+',' ','g'));
  if v_medicine is null then
   insert into public.medicine_directory(brand_name,generic_name,strength,dosage_form,manufacturer,active,source) values(v_row->>'medicine_name',nullif(v_row->>'generic_name',''),nullif(v_row->>'strength',''),v_row->>'dosage_form',nullif(v_row->>'manufacturer',''),coalesce((v_row->>'active')::boolean,true),'bulk import') returning id into v_medicine;v_created_medicines:=v_created_medicines+1;
  end if;
  select id into v_batch from public.medicine_batches where medicine_id=v_medicine and lower(regexp_replace(trim(batch_number),'\s+',' ','g'))=lower(regexp_replace(trim(v_row->>'batch_number'),'\s+',' ','g')) for update;
  if v_batch is not null then
   update public.medicine_batches set quantity=quantity+(v_row->>'opening_quantity')::integer,expiry_date=(v_row->>'expiry_date')::date,purchase_price_paise=nullif(v_row->>'purchase_price_paise','')::bigint,selling_price_paise=(v_row->>'selling_price_paise')::bigint,low_stock_threshold=coalesce((v_row->>'low_stock_threshold')::integer,10),active=coalesce((v_row->>'active')::boolean,true),updated_at=now() where id=v_batch;v_updated_batches:=v_updated_batches+1;
  else
   insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active) values(v_medicine,v_row->>'batch_number',(v_row->>'expiry_date')::date,(v_row->>'opening_quantity')::integer,nullif(v_row->>'purchase_price_paise','')::bigint,(v_row->>'selling_price_paise')::bigint,coalesce((v_row->>'low_stock_threshold')::integer,10),coalesce((v_row->>'active')::boolean,true));v_new_batches:=v_new_batches+1;
  end if;
 end loop;
 update public.bulk_import_jobs set success_count=v_row_count,error_count=0,status='ready',completed_at=now() where id=v_job;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'BULK_MEDICINE_IMPORT_COMPLETED','bulk_import_job',v_job,jsonb_build_object('file_name',p_file_name,'row_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches));
 return jsonb_build_object('job_id',v_job,'row_count',v_row_count,'success_count',v_row_count,'created_medicines',v_created_medicines,'new_batches',v_new_batches,'updated_batches',v_updated_batches);
exception when others then
 if v_job is not null then update public.bulk_import_jobs set status='failed',error_count=v_row_count,completed_at=now() where id=v_job;end if;raise;
end $$;
revoke all on function public.bulk_import_medicines(jsonb,text,uuid) from public;
grant execute on function public.bulk_import_medicines(jsonb,text,uuid) to authenticated;
commit;
