begin;

create table public.notification_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null check (char_length(notification_key) between 3 and 200),
  read_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

create index notification_reads_retention_idx
  on public.notification_reads(read_at);

alter table public.notification_reads enable row level security;

create policy notification_reads_own_select
on public.notification_reads
for select
to authenticated
using (user_id = auth.uid());

create policy notification_reads_own_insert
on public.notification_reads
for insert
to authenticated
with check (user_id = auth.uid());

create policy notification_reads_own_update
on public.notification_reads
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update on public.notification_reads to authenticated;

commit;
