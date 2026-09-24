-- Audit logs are the fastest-growing table and the main threat to the 500 MB
-- Supabase free-tier database. At ~0.3 kB a row, a busy hospital writes roughly
-- 200k rows a year, and nothing was trimming them.
--
-- Clinical and financial records are NEVER touched by this: patients, visits,
-- consultations, prescriptions, payments and IP data are permanent. Only the
-- generic action log is aged out, and security-relevant events are kept far
-- longer than routine operational noise.
--
-- Runs on Supabase pg_cron, so it costs nothing on Vercel.
begin;

create or replace function public.prune_audit_logs()
returns integer
language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  delete from public.audit_logs
  where created_at < now() - interval '180 days'
    and action not in (
      -- Security and money events are retained for two years.
      'USER_CREATED','USER_DEACTIVATED','ROLE_CHANGED',
      'DOCTOR_CREATED','PATIENT_ARCHIVED',
      'EXPORT_GENERATED','EXPORT_DOWNLOADED','EXPORT_DELETED',
      'BULK_MEDICINE_IMPORT_COMPLETED'
    );
  get diagnostics v_deleted = row_count;

  delete from public.audit_logs
  where created_at < now() - interval '730 days';

  return v_deleted;
end $$;

revoke all on function public.prune_audit_logs() from public;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'prune-hospital-audit-logs';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  -- 02:10 IST on the 1st of each month (20:40 UTC on the last day).
  perform cron.schedule(
    'prune-hospital-audit-logs',
    '40 20 28-31 * *',
    'select public.prune_audit_logs()'
  );
end $$;

commit;
