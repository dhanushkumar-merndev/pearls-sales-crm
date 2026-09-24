-- Pearl Aesthetic & Wellness Clinic identity: letterhead settings and the
-- patient ID prefix. Existing UHIDs are never rewritten -- a printed ID must
-- keep working -- only new registrations get the PA- prefix.

alter table public.hospital_settings
  alter column hospital_name set default 'Pearl Aesthetic & Wellness Clinic';

update public.hospital_settings
set hospital_name = 'Pearl Aesthetic & Wellness Clinic',
    tagline = 'Surgeon-led aesthetic & reconstructive care',
    address = '#755, K.P. Aspire, 1st Floor, 80ft Road, 4th Block, Koramangala, Bengaluru, Karnataka 560034',
    phone = '+91 79008 02060',
    email = 'info@pearlaesthetic.in'
where id
  and hospital_name = 'Meenakshi Hospital';

create or replace function public.assign_patient_uhid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.uhid is null or trim(new.uhid) = '' then
    new.uhid := 'PA-' || lpad(nextval('public.uhid_sequence')::text, 6, '0');
  else
    new.uhid := upper(trim(new.uhid));
  end if;
  return new;
end
$$;
revoke execute on function public.assign_patient_uhid() from public, anon, authenticated;
