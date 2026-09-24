-- Secrets and visible connection metadata must commit together. Only the
-- server's service role can call these; the actor is rechecked in the DB.
create function public.save_meta_credentials(
  p_actor uuid, p_app_id text, p_app_secret_enc text, p_verify_token_enc text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id=p_actor and role='admin' and status='active') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_app_id !~ '^[0-9]{3,32}$' or p_app_secret_enc is null or p_verify_token_enc is null then
    raise exception 'invalid connection details' using errcode='22023';
  end if;
  perform 1 from public.meta_integration where id for update;
  if exists (select 1 from public.meta_integration where id and app_id is distinct from p_app_id) then
    update public.meta_pages set subscribed=false, subscribed_at=null;
    update public.meta_lead_forms set active=false;
    delete from public.meta_page_secrets;
  end if;
  insert into public.meta_integration_secrets(id,app_secret_enc,verify_token_enc)
  values (true,p_app_secret_enc,p_verify_token_enc)
  on conflict (id) do update set app_secret_enc=excluded.app_secret_enc,
    verify_token_enc=excluded.verify_token_enc, updated_at=now();
  update public.meta_integration set app_id=p_app_id, status='disconnected',
    connected_by=p_actor, last_error=null, last_error_at=null where id;
  insert into public.audit_logs(actor_user_id,action,entity_type)
  values (p_actor,'META_CREDENTIALS_SAVED','meta_integration');
end $$;

create function public.save_meta_page(
  p_actor uuid, p_page_id text, p_name text, p_token_enc text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id=p_actor and role='admin' and status='active') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  insert into public.meta_pages(page_id,name,subscribed,subscribed_at)
  values(p_page_id,left(p_name,200),true,now())
  on conflict(page_id) do update set name=excluded.name,subscribed=true,subscribed_at=now();
  insert into public.meta_page_secrets(page_id,access_token_enc)
  values(p_page_id,p_token_enc)
  on conflict(page_id) do update set access_token_enc=excluded.access_token_enc,updated_at=now();
  update public.meta_integration set status='connected',connected_at=now(),connected_by=p_actor,
    last_error=null,last_error_at=null where id;
  insert into public.audit_logs(actor_user_id,action,entity_type,metadata)
  values(p_actor,'META_PAGE_CONNECTED','meta_integration',jsonb_build_object('page_id',p_page_id));
end $$;

revoke execute on function public.save_meta_credentials(uuid,text,text,text), public.save_meta_page(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_meta_credentials(uuid,text,text,text), public.save_meta_page(uuid,text,text,text) to service_role;
