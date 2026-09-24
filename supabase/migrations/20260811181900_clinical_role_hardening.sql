begin;
create or replace function public.record_visit_vitals(p_visit_id uuid,p_weight_kg numeric,p_height_cm numeric,p_temperature_c numeric,p_bp_systolic smallint,p_bp_diastolic smallint,p_pulse smallint,p_spo2 smallint,p_respiratory_rate smallint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_id uuid;v_doctor uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role not in ('admin','op','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.visits where id=p_visit_id and status not in ('completed','cancelled') and (v_role<>'doctor' or doctor_id=v_doctor)) then raise exception 'visit unavailable' using errcode='42501';end if;
 insert into public.vitals(visit_id,weight_kg,height_cm,temperature_c,bp_systolic,bp_diastolic,pulse,spo2,respiratory_rate,notes) values(p_visit_id,p_weight_kg,p_height_cm,p_temperature_c,p_bp_systolic,p_bp_diastolic,p_pulse,p_spo2,p_respiratory_rate,p_notes) on conflict(visit_id) do update set weight_kg=excluded.weight_kg,height_cm=excluded.height_cm,temperature_c=excluded.temperature_c,bp_systolic=excluded.bp_systolic,bp_diastolic=excluded.bp_diastolic,pulse=excluded.pulse,spo2=excluded.spo2,respiratory_rate=excluded.respiratory_rate,notes=excluded.notes,recorded_by=auth.uid(),updated_at=now() returning id into v_id;
 update public.visits set status='ready' where id=p_visit_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'VITALS_RECORDED','visit',p_visit_id);return v_id;
end $$;

drop policy if exists vitals_write on public.vitals;
create policy vitals_write on public.vitals for all to authenticated using(public.current_app_role() in ('admin','op') or (public.current_app_role()='doctor' and exists(select 1 from public.visits v where v.id=visit_id and v.doctor_id=public.current_doctor_id()))) with check(public.current_app_role() in ('admin','op') or (public.current_app_role()='doctor' and exists(select 1 from public.visits v where v.id=visit_id and v.doctor_id=public.current_doctor_id())));

create function public.protect_closed_visit_vitals() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.visits where id=coalesce(new.visit_id,old.visit_id) and status in ('completed','cancelled')) then raise exception 'closed visit vitals are immutable';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_closed_visit_vitals before insert or update or delete on public.vitals for each row execute function public.protect_closed_visit_vitals();

create function public.protect_prescription_status() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('dispensed','cancelled') and new.status<>old.status then raise exception 'closed prescription is immutable';end if;
 if old.status<>'draft' and new.status='draft' then raise exception 'prescription cannot return to draft';end if;
 if public.current_app_role()='doctor' and old.status<>'draft' and new.status<>old.status then raise exception 'completed prescription lifecycle is controlled by pharmacy';end if;
 return new;
end $$;
create trigger protect_prescription_status before update on public.prescriptions for each row execute function public.protect_prescription_status();
commit;
