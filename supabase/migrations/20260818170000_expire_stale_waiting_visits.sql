-- A visit stuck in 'waiting' / 'vitals_pending' / 'ready' from a day that has
-- already passed will never be picked up again -- /op and /doctor already
-- scope their queues to today's visit_date, so it is already invisible there.
-- But it still shows up as an actionable-looking "Waiting" badge on
-- cross-day views like the dashboard's "Recent visits" feed, which is
-- confusing: that token was never called and now never will be.
--
-- Auto-cancelled, not auto-completed: 'completed' implies the consultation
-- and its fee were actually resolved, which would misrepresent a no-show as
-- a real visit in financial/clinical reporting. 'in_consultation' is
-- deliberately left alone -- that is an active clinical encounter a human
-- should close out, not something the system silently kills at midnight.
begin;

create or replace function public.expire_stale_waiting_visits_internal()
returns integer
language plpgsql security definer set search_path='' as $$
declare v_count integer; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  update public.visits
  set status = 'cancelled',
      notes = trim(both from coalesce(notes,'') || case when coalesce(notes,'')='' then '' else E'\n' end
        || 'Auto-cancelled: visit date passed without being called.')
  where status in ('waiting','vitals_pending','ready')
    and visit_date < v_today;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_logs(action,entity_type,metadata)
    values('VISITS_AUTO_CANCELLED','visit',jsonb_build_object('count',v_count,'as_of',v_today));
  end if;
  return v_count;
end $$;

revoke all on function public.expire_stale_waiting_visits_internal() from public;

create extension if not exists pg_cron;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'expire-stale-hospital-visits';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'expire-stale-hospital-visits',
    '*/15 * * * *',
    'select public.expire_stale_waiting_visits_internal()'
  );
end $$;

select public.expire_stale_waiting_visits_internal();

commit;
