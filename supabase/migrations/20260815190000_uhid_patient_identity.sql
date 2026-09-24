-- UHID becomes the compulsory unique patient identifier; the phone number stops
-- being unique.
--
-- Rural families routinely share one mobile number, so a UNIQUE constraint on
-- phone_normalized made it impossible to register a mother and her children.
-- UHID takes over as the identity key, phone becomes ordinary contact data
-- (still indexed, still searchable, just no longer unique).
--
-- The internal primary key stays patients.id (uuid); UHID is the human-facing
-- identifier printed on tokens and prescriptions.
begin;

create sequence if not exists public.uhid_sequence start 1;

alter table public.patients add column if not exists uhid text;
-- Who referred the patient (doctor, camp, another hospital, walk-in).
alter table public.patients add column if not exists reference_detail text;
-- Rural patients often know their age but not their date of birth. When only an
-- age is given the UI derives a dob, and this records that it was approximate
-- so nobody later mistakes it for a real birth date.
alter table public.patients add column if not exists dob_is_approximate boolean not null default false;

-- Backfill before the NOT NULL constraint lands.
update public.patients
set uhid = 'MH-' || lpad(nextval('public.uhid_sequence')::text, 6, '0')
where uhid is null;

alter table public.patients alter column uhid set not null;

-- Auto-issue for any row that does not supply one.
create or replace function public.assign_patient_uhid()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.uhid is null or trim(new.uhid) = '' then
    new.uhid := 'MH-' || lpad(nextval('public.uhid_sequence')::text, 6, '0');
  else
    new.uhid := upper(trim(new.uhid));
  end if;
  return new;
end $$;

drop trigger if exists assign_patient_uhid on public.patients;
create trigger assign_patient_uhid
before insert on public.patients
for each row execute function public.assign_patient_uhid();

-- UHID is now the unique identity; phone is shared contact data.
create unique index if not exists patients_uhid_key on public.patients(uhid);
alter table public.patients drop constraint if exists patients_phone_normalized_key;
create index if not exists patients_phone_idx on public.patients(phone_normalized);
create index if not exists patients_uhid_search_idx on public.patients(lower(uhid) text_pattern_ops);

commit;
