-- IP staff own the operational discharge workflow for their assigned tickets.
-- Keep doctor summaries constrained to the treating doctor's own patients.
begin;

create or replace function public.save_ip_discharge_summary(
  p_ticket_id uuid, p_final_diagnosis text, p_hospital_course text,
  p_treatment_summary text, p_discharge_medicines text,
  p_discharge_advice text, p_follow_up text, p_chief_complaint text default null,
  p_procedure_done text default null, p_operative_notes text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role;
  v_doctor uuid;
begin
  v_role := public.current_app_role();
  v_doctor := public.current_doctor_id();
  if v_role not in ('admin', 'doctor', 'ip') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform set_config('app.ip_discharge_workflow', 'on', true);
  update public.ip_tickets
  set final_diagnosis = p_final_diagnosis,
      hospital_course = p_hospital_course,
      treatment_summary = p_treatment_summary,
      discharge_medicines = p_discharge_medicines,
      discharge_advice = p_discharge_advice,
      follow_up = p_follow_up,
      chief_complaint = p_chief_complaint,
      procedure_done = p_procedure_done,
      operative_notes = p_operative_notes,
      status = 'discharge_pending'
  where id = p_ticket_id
    and status in ('admitted', 'discharge_pending')
    and (
      v_role = 'admin'
      or (v_role = 'doctor' and doctor_id = v_doctor)
      or (v_role = 'ip' and assigned_ip_staff_id = auth.uid())
    );
  if not found then
    raise exception 'IP ticket unavailable' using errcode = '42501';
  end if;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
  values (auth.uid(), 'IP_DISCHARGE_SUMMARY_SAVED', 'ip_ticket', p_ticket_id);
  return p_ticket_id;
end;
$$;

revoke all on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.save_ip_discharge_summary(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

commit;
