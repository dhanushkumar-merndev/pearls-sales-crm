-- Admin Settings shows how much patient-document storage is used.
--
-- storage.objects is readable only through policies scoped to a bucket, and the
-- byte size lives in the metadata jsonb, so a definer function keeps the query
-- off the client and out of reach of non-admin roles.
begin;

create or replace function public.storage_usage_summary()
returns table(
  bucket_id text,
  object_count bigint,
  total_bytes bigint,
  quota_bytes bigint
)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
  select b.id,
         count(o.id),
         coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         b.file_size_limit
  from storage.buckets b
  left join storage.objects o on o.bucket_id = b.id
  group by b.id, b.file_size_limit
  order by b.id;
end $$;

revoke all on function public.storage_usage_summary() from public;
grant execute on function public.storage_usage_summary() to authenticated;

commit;
