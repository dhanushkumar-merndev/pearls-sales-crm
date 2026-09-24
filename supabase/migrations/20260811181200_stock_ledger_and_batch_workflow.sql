begin;
create table public.stock_movements(
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.medicine_batches(id) on delete restrict,
 quantity_delta integer not null check(quantity_delta<>0),
 reason text not null,
 idempotency_key uuid not null unique,
 created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index stock_movements_batch_idx on public.stock_movements(batch_id,created_at desc);
alter table public.stock_movements enable row level security;
create policy stock_movements_read on public.stock_movements for select to authenticated using(public.current_app_role() in ('admin','pharmacy'));
grant select on public.stock_movements to authenticated;
revoke insert on public.medicine_batches from authenticated;

create function public.save_medicine_batch(p_batch_id uuid,p_medicine_id uuid,p_batch_number text,p_expiry_date date,p_quantity_delta integer,p_purchase_price_paise bigint,p_selling_price_paise bigint,p_low_stock_threshold integer,p_active boolean,p_reason text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_id uuid;v_quantity integer;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','pharmacy') then raise exception 'forbidden' using errcode='42501';end if;
 if p_selling_price_paise<0 or p_purchase_price_paise<0 or p_low_stock_threshold<0 then raise exception 'invalid stock metadata';end if;
 select id into v_id from public.stock_movements where idempotency_key=p_idempotency_key;
 if found then select batch_id into v_id from public.stock_movements where idempotency_key=p_idempotency_key;return v_id;end if;
 if p_batch_id is null then
  insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price_paise,selling_price_paise,low_stock_threshold,active)
  values(p_medicine_id,trim(p_batch_number),p_expiry_date,0,p_purchase_price_paise,p_selling_price_paise,p_low_stock_threshold,p_active) returning id into v_id;
 else
  update public.medicine_batches set batch_number=trim(p_batch_number),expiry_date=p_expiry_date,purchase_price_paise=p_purchase_price_paise,selling_price_paise=p_selling_price_paise,low_stock_threshold=p_low_stock_threshold,active=p_active where id=p_batch_id and medicine_id=p_medicine_id returning id into v_id;
  if not found then raise exception 'batch unavailable' using errcode='42501';end if;
 end if;
 select quantity into v_quantity from public.medicine_batches where id=v_id for update;
 if v_quantity+p_quantity_delta<0 then raise exception 'stock cannot become negative';end if;
 if p_quantity_delta<>0 then
  update public.medicine_batches set quantity=quantity+p_quantity_delta where id=v_id;
  insert into public.stock_movements(batch_id,quantity_delta,reason,idempotency_key) values(v_id,p_quantity_delta,coalesce(nullif(trim(p_reason),''),'Manual stock adjustment'),p_idempotency_key);
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),case when p_quantity_delta=0 then 'STOCK_METADATA_UPDATED' else 'STOCK_ADJUSTED' end,'medicine_batch',v_id,jsonb_build_object('quantity_delta',p_quantity_delta));
 return v_id;
end $$;
revoke all on function public.save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid) from public;
grant execute on function public.save_medicine_batch(uuid,uuid,text,date,integer,bigint,bigint,integer,boolean,text,uuid) to authenticated;
commit;
