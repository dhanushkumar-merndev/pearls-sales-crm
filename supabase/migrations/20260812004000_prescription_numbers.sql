begin;

-- A short, printable identifier for pharmacy lookup. The sequence is the
-- source of truth, so concurrent doctor completions cannot create duplicates.
create sequence public.prescription_number_seq as bigint start with 1;

alter table public.prescriptions
  add column prescription_number bigint;

alter sequence public.prescription_number_seq
  owned by public.prescriptions.prescription_number;

alter table public.prescriptions
  alter column prescription_number
  set default nextval('public.prescription_number_seq'::regclass);

update public.prescriptions
set prescription_number = nextval('public.prescription_number_seq'::regclass)
where prescription_number is null;

alter table public.prescriptions
  alter column prescription_number set not null,
  add constraint prescriptions_prescription_number_positive
    check (prescription_number > 0),
  add constraint prescriptions_prescription_number_key
    unique (prescription_number);

commit;
