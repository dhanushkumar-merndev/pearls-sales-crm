-- DATA-LOSS FIX -- IP staff could add exactly ONE manual charge, ever.
--
-- ip_charges_source_type_source_id_key was declared
--     UNIQUE NULLS NOT DISTINCT (source_type, source_id)
-- to stop a pharmacy dispense or a doctor's chargeable visit from being billed
-- twice. But a manually entered charge (nebulisation, dressing, room, bed) has
-- source_type = NULL and source_id = NULL, and NULLS NOT DISTINCT treats every
-- one of those pairs as equal -- so the first manual charge in the whole table
-- claimed the slot and every later one was rejected with 23505.
--
-- addIpCharge translated any 23505 into "Charge already recorded.", so the
-- dialog closed with a green toast and the charge silently disappeared. The
-- database has 25 charges and exactly 1 of them is manual; every manual charge
-- entered since has been lost, and with it the money it represented.
--
-- The uniqueness is only meaningful for derived charges, so scope it to rows
-- that actually have a source.
begin;

alter table public.ip_charges
  drop constraint if exists ip_charges_source_type_source_id_key;

create unique index if not exists ip_charges_source_unique_idx
  on public.ip_charges (source_type, source_id)
  where source_type is not null and source_id is not null;

commit;
