begin;

create function public.protect_completed_consultation() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='completed' and coalesce(current_setting('app.allow_clinical_amendment',true),'off')<>'on' then raise exception 'completed consultation is immutable';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_completed_consultation before update or delete on public.consultations for each row execute function public.protect_completed_consultation();

create function public.protect_prescription_content() returns trigger language plpgsql set search_path='' as $$
declare v_status public.prescription_status;
begin
 select status into v_status from public.prescriptions where id=coalesce(new.prescription_id,old.prescription_id);
 if v_status<>'draft' then
  if tg_op='DELETE' or tg_op='INSERT' then raise exception 'completed prescription content is immutable';end if;
  if new.medicine_id is distinct from old.medicine_id or new.medicine_name is distinct from old.medicine_name or new.dose is distinct from old.dose or new.frequency is distinct from old.frequency or new.duration is distinct from old.duration or new.route is distinct from old.route or new.notes is distinct from old.notes or new.requested_quantity is distinct from old.requested_quantity then raise exception 'completed prescription content is immutable';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_prescription_content before insert or update or delete on public.prescription_items for each row execute function public.protect_prescription_content();

create function public.prevent_visit_overpayment() returns trigger language plpgsql set search_path='' as $$
declare v_fee bigint;v_paid bigint;
begin
 select fee_paise into v_fee from public.visits where id=new.visit_id for update;
 select coalesce(sum(amount_paise),0) into v_paid from public.visit_payments where visit_id=new.visit_id;
 if v_paid+new.amount_paise>v_fee then raise exception 'payment exceeds outstanding visit balance';end if;
 return new;
end $$;
create trigger prevent_visit_overpayment before insert on public.visit_payments for each row execute function public.prevent_visit_overpayment();

drop policy ip_charges_write on public.ip_charges;
create policy ip_charges_write on public.ip_charges for insert to authenticated with check(public.current_app_role() in ('admin','ip'));

commit;
