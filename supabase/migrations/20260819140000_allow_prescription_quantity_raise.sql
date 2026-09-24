begin;

-- Bug: protect_prescription_content() (20260811174000) blocks ANY change to
-- prescription_items.requested_quantity once the prescription leaves 'draft'
-- -- which is every prescription that ever reaches the pharmacy counter (they
-- move to 'pending' the moment the doctor submits). That silently defeats the
-- "extra day" bump dispense_prescription added later (20260818110000): the
-- RPC's own `update prescription_items set requested_quantity=v_new_requested`
-- always hit this trigger and failed with "completed prescription content is
-- immutable", which the dispense server action then reports as the generic
-- "Dispensing failed; no stock was changed." -- masking the real cause.
--
-- Fix: the trigger already enforces every other field is frozen once
-- non-draft; extend it to allow requested_quantity specifically to increase
-- (never decrease), matching the RPC's own comment that the bump "can only
-- increase, never used to silently shrink what was prescribed."
create or replace function public.protect_prescription_content() returns trigger language plpgsql set search_path='' as $$
declare v_status public.prescription_status;
begin
 select status into v_status from public.prescriptions where id=coalesce(new.prescription_id,old.prescription_id);
 if v_status<>'draft' then
  if tg_op='DELETE' or tg_op='INSERT' then raise exception 'completed prescription content is immutable';end if;
  if new.medicine_id is distinct from old.medicine_id or new.medicine_name is distinct from old.medicine_name or new.dose is distinct from old.dose or new.frequency is distinct from old.frequency or new.duration is distinct from old.duration or new.route is distinct from old.route or new.notes is distinct from old.notes
     or new.requested_quantity < old.requested_quantity then raise exception 'completed prescription content is immutable';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

commit;
