begin;

-- A completed consultation is the authoritative terminal event for an OP
-- visit. Keep the queue status synchronized even when clinical data is
-- imported or written outside the normal consultation RPC.
create or replace function public.sync_completed_consultation_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'amended') then
    update public.visits
    set status = 'completed'
    where id = new.visit_id and status <> 'completed';
  end if;
  return new;
end $$;

create trigger sync_completed_consultation_visit
after insert or update of status on public.consultations
for each row execute function public.sync_completed_consultation_visit();

-- Repair any existing imported records that predate the invariant.
update public.visits v
set status = 'completed'
where v.status <> 'completed'
  and exists (
    select 1 from public.consultations c
    where c.visit_id = v.id and c.status in ('completed', 'amended')
  );

commit;
