-- Three related gaps closed together.
begin;

-- 1. Reception can reprint an old prescription -------------------------------
-- prescriptions_read allowed only admin/pharmacy/doctor, so reception opening
-- the print page silently rendered an empty Rx block even though AGENTS.md 49
-- lists "Old Prescription reprint" as a required action.
--
-- SELECT only. Reception still cannot write clinical content: the existing
-- prescriptions_doctor_write / consultations_doctor_write policies are unchanged,
-- and completed records remain immutable via their triggers.
drop policy if exists prescriptions_read on public.prescriptions;
create policy prescriptions_read on public.prescriptions for select to authenticated
  using(public.current_app_role() in ('admin','pharmacy','doctor','reception'));

drop policy if exists consultations_read on public.consultations;
create policy consultations_read on public.consultations for select to authenticated
  using(public.current_app_role() in ('admin','doctor','op','ip','reception'));

-- 2. Optional consultation fee on the printed prescription --------------------
-- Default false: a prescription is a clinical document the patient may show at
-- another hospital or lab, and AGENTS.md 24 keeps prices off it. Hospitals that
-- want the amount printed can switch this on.
alter table public.hospital_settings
  add column if not exists print_fee_on_prescription boolean not null default false;

-- 3. OP fee must be settled before admission ---------------------------------
-- The OP assistant walks the patient to billing, then to IP. Enforced as a
-- trigger rather than inside create_ip_ticket so every admission path is
-- covered, including direct inserts by admin tooling.
create or replace function public.require_settled_op_fee()
returns trigger language plpgsql set search_path='' as $$
declare v_balance bigint;
begin
  if new.source_visit_id is null then return new; end if;
  select v.fee_paise - coalesce(sum(vp.amount_paise), 0)
    into v_balance
  from public.visits v
  left join public.visit_payments vp on vp.visit_id = v.id
  where v.id = new.source_visit_id
  group by v.fee_paise;
  if coalesce(v_balance, 0) > 0 then
    raise exception 'outstanding OP consultation fee of % paise must be collected before admission', v_balance
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists require_settled_op_fee on public.ip_tickets;
create trigger require_settled_op_fee
before insert on public.ip_tickets
for each row execute function public.require_settled_op_fee();

commit;
