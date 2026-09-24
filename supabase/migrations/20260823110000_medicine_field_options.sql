-- Self-learning dropdowns for the Add/Edit medicine dialog: a pharmacist can
-- type a dosage form or manufacturer that has never been used before, and it
-- becomes a selectable option for everyone from the next dialog onwards.
--
-- The options deliberately do NOT come from `select distinct` over
-- medicine_directory: that cost grows with the directory (millions of rows on
-- a real import), and it would be paid on every dialog open. They are kept in
-- their own small table, maintained by a trigger, so reading them is
-- proportional to the number of distinct options -- a few hundred at most.

create table if not exists medicine_field_options (
  field text not null check (field in ('dosage_form', 'manufacturer', 'generic_name', 'strength')),
  value text not null,
  usage_count integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (field, value)
);

-- The dialog reads one field at a time, most-used first.
create index if not exists medicine_field_options_rank_idx
  on medicine_field_options (field, usage_count desc, value);

alter table medicine_field_options enable row level security;

drop policy if exists "medicine_field_options_read" on medicine_field_options;
create policy "medicine_field_options_read" on medicine_field_options for select
  using ((select current_app_role()) = any (array['admin','pharmacy','doctor']::app_role[]));

-- Writes happen only through the trigger below (security definer), never
-- directly from a client -- there is no insert/update/delete policy.

create or replace function learn_medicine_field_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into medicine_field_options (field, value)
  select field, value
  from (
    values
      ('dosage_form', nullif(btrim(new.dosage_form), '')),
      ('manufacturer', nullif(btrim(new.manufacturer), '')),
      ('generic_name', nullif(btrim(new.generic_name), '')),
      ('strength', nullif(btrim(new.strength), ''))
  ) as entered(field, value)
  where value is not null
  on conflict (field, value)
    do update set usage_count = medicine_field_options.usage_count + 1;
  return new;
end;
$$;

drop trigger if exists learn_medicine_field_options_trigger on medicine_directory;
create trigger learn_medicine_field_options_trigger
  after insert or update of dosage_form, manufacturer, generic_name, strength
  on medicine_directory
  for each row execute function learn_medicine_field_options();

-- Seed from whatever the directory already holds. This one pass is a full
-- scan by design; every option afterwards arrives through the trigger.
insert into medicine_field_options (field, value, usage_count)
select field, value, count(*)
from medicine_directory,
  lateral (
    values
      ('dosage_form', nullif(btrim(dosage_form), '')),
      ('manufacturer', nullif(btrim(manufacturer), '')),
      ('generic_name', nullif(btrim(generic_name), '')),
      ('strength', nullif(btrim(strength), ''))
  ) as entered(field, value)
where value is not null
group by field, value
on conflict (field, value) do nothing;

-- One round trip returns every list the dialog needs, capped so a directory
-- with thousands of distinct manufacturers cannot make the payload unbounded.
create or replace function get_medicine_field_options(p_limit integer default 200)
returns table (field text, value text)
language sql
stable
security invoker
set search_path = public
as $$
  select field, value
  from (
    select field, value,
           row_number() over (partition by field order by usage_count desc, value) as rank
    from medicine_field_options
  ) ranked
  where rank <= least(greatest(coalesce(p_limit, 200), 1), 500)
  order by field, value;
$$;

grant execute on function get_medicine_field_options(integer) to authenticated;
