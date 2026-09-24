-- The printed documents carried a hardcoded "Meenakshi Hospital" plus invented
-- taglines ("Professional medical care", "Hospital Management & Patient Care"),
-- and never printed the address, phone or email at all. The hospital letterhead
-- carries the motto "Care - Healing - Hope." and the full contact block, so the
-- documents have to as well.
--
-- hospital_settings already holds address/phone/email but no row was ever
-- created, so every print fell back to nothing. This seeds the real letterhead
-- and adds the motto as an editable field rather than a constant in the code.
begin;

alter table public.hospital_settings
  add column if not exists tagline text;

insert into public.hospital_settings (id, hospital_name, tagline, address, phone, email)
values (
  true,
  'Meenakshi Hospital',
  'Care • Healing • Hope.',
  '1st Street, Ramnagar, Pattinamkathan, Ramanathapuram, PIN: 623503',
  '+91 78128 33761',
  'meenakshihospitalrmd@gmail.com'
)
-- Never overwrite what the hospital has already typed into Settings; only fill
-- the blanks.
on conflict (id) do update set
  tagline = coalesce(hospital_settings.tagline, excluded.tagline),
  address = coalesce(hospital_settings.address, excluded.address),
  phone   = coalesce(hospital_settings.phone,   excluded.phone),
  email   = coalesce(hospital_settings.email,   excluded.email);

commit;
