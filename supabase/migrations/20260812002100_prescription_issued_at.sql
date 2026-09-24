begin;

-- A prescription row can exist as a draft for hours or days. The pharmacy
-- window starts only when the doctor completes the consultation and moves the
-- prescription from draft to pending.
create or replace function public.set_prescription_issued_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'pending' then
    new.created_at := now();
  end if;
  return new;
end
$$;

create trigger set_prescription_issued_at
before update of status on public.prescriptions
for each row execute function public.set_prescription_issued_at();

commit;
