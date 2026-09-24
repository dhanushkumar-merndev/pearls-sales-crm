-- prevent_visit_overpayment() reads public.visits, but `authenticated` has no
-- table-level SELECT grant on it (all reads normally go through security
-- definer RPCs). Every existing caller of visit_payments happened to be one
-- of those RPCs, so the trigger's own privileges never mattered -- until the
-- direct-insert path RLS already allowed for admin/reception
-- (visit_payments_insert) was actually exercised for the first time (the new
-- "collect outstanding OP fee with no medicines" flow), which fails outright
-- with "permission denied for table visits" before the balance is even
-- checked.
begin;

create or replace function public.prevent_visit_overpayment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_fee bigint;v_paid bigint;
begin
 select fee_paise into v_fee from public.visits where id=new.visit_id for update;
 select coalesce(sum(amount_paise),0) into v_paid from public.visit_payments where visit_id=new.visit_id;
 if v_paid+new.amount_paise>v_fee then raise exception 'payment exceeds outstanding visit balance';end if;
 return new;
end $$;

commit;
