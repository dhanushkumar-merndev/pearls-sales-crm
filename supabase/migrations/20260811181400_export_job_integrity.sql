begin;
create unique index one_active_export_generation on public.export_jobs(export_month,include_documents,created_by) where status in ('queued','processing');
alter table public.export_jobs add constraint export_object_ready check(status<>'ready' or (object_path is not null and size_bytes is not null and completed_at is not null));
commit;
