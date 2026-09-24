-- Clinical discharge summary gains three fields: Chief Complaint (always
-- shown) and Procedure Done / Operative Notes (only meaningful, and only
-- shown in the UI, when the consultant checks "Procedure / surgery
-- performed" -- a routine medical admission has no operative note to write).
begin;

-- if not exists: an earlier hotfix added these same three columns directly
-- when the IP print routes were 404ing, so this migration has to be able to
-- land on a database that already has them.
alter table public.ip_tickets
  add column if not exists chief_complaint text,
  add column if not exists procedure_done text,
  add column if not exists operative_notes text;

-- protect_ip_discharge_workflow guards every clinical discharge field against
-- being changed outside save_ip_discharge_summary's controlled workflow --
-- the three new columns need to join that guarded tuple, or they'd be
-- editable through any other path with no audit trail and no immutability
-- once discharged.
create or replace function public.protect_ip_discharge_workflow() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='discharged' then raise exception 'discharged IP ticket is immutable';end if;
 if (new.final_diagnosis,new.hospital_course,new.treatment_summary,new.discharge_medicines,new.discharge_advice,new.follow_up,new.chief_complaint,new.procedure_done,new.operative_notes)
    is distinct from
    (old.final_diagnosis,old.hospital_course,old.treatment_summary,old.discharge_medicines,old.discharge_advice,old.follow_up,old.chief_complaint,old.procedure_done,old.operative_notes)
    and coalesce(current_setting('app.ip_discharge_workflow',true),'off')<>'on'
 then raise exception 'clinical discharge fields require the controlled workflow';end if;
 if new.status='discharged' and old.status<>'discharged'
    and coalesce(current_setting('app.ip_discharge_workflow',true),'off')<>'on'
 then raise exception 'IP discharge requires the controlled workflow';end if;
 return new;
end $$;

-- Signature change: same lesson as 20260818230000 and 20260819120000 --
-- CREATE OR REPLACE cannot fold an added parameter into the existing
-- function, it silently adds a second overload, so the old 7-arg signature
-- is dropped first.
drop function if exists public.save_ip_discharge_summary(uuid,text,text,text,text,text,text);

create function public.save_ip_discharge_summary(
  p_ticket_id uuid, p_final_diagnosis text, p_hospital_course text, p_treatment_summary text,
  p_discharge_medicines text, p_discharge_advice text, p_follow_up text,
  p_chief_complaint text default null, p_procedure_done text default null, p_operative_notes text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role not in ('admin','doctor') then raise exception 'forbidden' using errcode='42501';end if;
 perform set_config('app.ip_discharge_workflow','on',true);
 update public.ip_tickets set final_diagnosis=p_final_diagnosis,hospital_course=p_hospital_course,treatment_summary=p_treatment_summary,discharge_medicines=p_discharge_medicines,discharge_advice=p_discharge_advice,follow_up=p_follow_up,chief_complaint=p_chief_complaint,procedure_done=p_procedure_done,operative_notes=p_operative_notes,status='discharge_pending' where id=p_ticket_id and status in ('admitted','discharge_pending') and (v_role='admin' or doctor_id=v_doctor);
 if not found then raise exception 'IP ticket unavailable' using errcode='42501';end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_DISCHARGE_SUMMARY_SAVED','ip_ticket',p_ticket_id);return p_ticket_id;
end $$;

revoke all on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

commit;
