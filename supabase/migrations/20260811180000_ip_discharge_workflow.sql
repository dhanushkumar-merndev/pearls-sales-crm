begin;
alter table public.ip_tickets add column treatment_summary text,add column discharge_medicines text,add column follow_up text;

create function public.protect_ip_discharge_workflow() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='discharged' then raise exception 'discharged IP ticket is immutable';end if;
 if (new.final_diagnosis,new.hospital_course,new.treatment_summary,new.discharge_medicines,new.discharge_advice,new.follow_up)
    is distinct from
    (old.final_diagnosis,old.hospital_course,old.treatment_summary,old.discharge_medicines,old.discharge_advice,old.follow_up)
    and coalesce(current_setting('app.ip_discharge_workflow',true),'off')<>'on'
 then raise exception 'clinical discharge fields require the controlled workflow';end if;
 if new.status='discharged' and old.status<>'discharged'
    and coalesce(current_setting('app.ip_discharge_workflow',true),'off')<>'on'
 then raise exception 'IP discharge requires the controlled workflow';end if;
 return new;
end $$;
create trigger protect_ip_discharge_workflow before update on public.ip_tickets for each row execute function public.protect_ip_discharge_workflow();

create function public.add_ip_progress_note(p_ticket_id uuid,p_note text,p_chargeable boolean,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;v_note uuid;v_fee bigint;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.ip_tickets where id=p_ticket_id and status='admitted' and (v_role='admin' or doctor_id=v_doctor)) then raise exception 'IP ticket unavailable' using errcode='42501';end if;
 select id into v_note from public.ip_progress_notes where idempotency_key=p_idempotency_key;if v_note is not null then return v_note;end if;
 if v_role='admin' and v_doctor is null then select doctor_id into v_doctor from public.ip_tickets where id=p_ticket_id;end if;
 insert into public.ip_progress_notes(ip_ticket_id,doctor_id,note,chargeable,idempotency_key) values(p_ticket_id,v_doctor,p_note,p_chargeable,p_idempotency_key) returning id into v_note;
 if p_chargeable then select ip_visit_fee_paise into v_fee from public.doctors where id=v_doctor;insert into public.ip_charges(ip_ticket_id,category,item,quantity,rate_paise,source_type,source_id,idempotency_key) values(p_ticket_id,'doctor','IP Doctor Visit',1,coalesce(v_fee,0),'ip_progress_note',v_note,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_PROGRESS_NOTE_ADDED','ip_progress_note',v_note);return v_note;
end $$;

create function public.save_ip_discharge_summary(p_ticket_id uuid,p_final_diagnosis text,p_hospital_course text,p_treatment_summary text,p_discharge_medicines text,p_discharge_advice text,p_follow_up text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 perform set_config('app.ip_discharge_workflow','on',true);
 update public.ip_tickets set final_diagnosis=p_final_diagnosis,hospital_course=p_hospital_course,treatment_summary=p_treatment_summary,discharge_medicines=p_discharge_medicines,discharge_advice=p_discharge_advice,follow_up=p_follow_up,status='discharge_pending' where id=p_ticket_id and status in ('admitted','discharge_pending') and (v_role='admin' or doctor_id=v_doctor);
 if not found then raise exception 'IP ticket unavailable' using errcode='42501';end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_DISCHARGE_SUMMARY_SAVED','ip_ticket',p_ticket_id);return p_ticket_id;
end $$;

create function public.complete_ip_discharge(p_ticket_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_total bigint;v_paid bigint;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','ip') then raise exception 'forbidden' using errcode='42501';end if;
 perform 1 from public.ip_tickets where id=p_ticket_id and status='discharge_pending' and final_diagnosis is not null for update;if not found then raise exception 'clinical discharge summary is required';end if;
 select coalesce(sum(amount_paise),0) into v_total from public.ip_charges where ip_ticket_id=p_ticket_id;select coalesce(sum(amount_paise),0) into v_paid from public.ip_payments where ip_ticket_id=p_ticket_id;
 if v_paid<v_total then raise exception 'outstanding balance remains';end if;
 perform set_config('app.ip_discharge_workflow','on',true);
 update public.ip_tickets set status='discharged',discharge_at=now() where id=p_ticket_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'IP_DISCHARGED','ip_ticket',p_ticket_id,jsonb_build_object('total_paise',v_total,'paid_paise',v_paid));return p_ticket_id;
end $$;
revoke all on function public.add_ip_progress_note(uuid,text,boolean,uuid) from public;revoke all on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text) from public;revoke all on function public.complete_ip_discharge(uuid) from public;
grant execute on function public.add_ip_progress_note(uuid,text,boolean,uuid) to authenticated;grant execute on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text) to authenticated;grant execute on function public.complete_ip_discharge(uuid) to authenticated;
drop policy if exists ip_notes_doctor on public.ip_progress_notes;
commit;
