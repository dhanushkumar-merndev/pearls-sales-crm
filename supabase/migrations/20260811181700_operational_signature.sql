begin;
create function public.operational_data_signature() returns text language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;v_value text;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null then raise exception 'forbidden' using errcode='42501';end if;
 case v_role
  when 'reception' then select concat_ws('|',max(v.updated_at),(select max(created_at) from public.visit_payments),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.consultations)) into v_value from public.visits v;
  when 'op' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.vitals),(select max(updated_at) from public.patient_reports)) into v_value from public.visits v;
  when 'doctor' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.consultations where doctor_id=v_doctor),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.ip_tickets where doctor_id=v_doctor)) into v_value from public.visits v where v.doctor_id=v_doctor;
  when 'ip' then select concat_ws('|',max(t.updated_at),(select max(created_at) from public.ip_charges),(select max(created_at) from public.ip_payments),(select max(updated_at) from public.patient_reports)) into v_value from public.ip_tickets t;
  when 'pharmacy' then select concat_ws('|',max(p.updated_at),(select max(updated_at) from public.medicine_batches),(select max(created_at) from public.pharmacy_sales)) into v_value from public.prescriptions p;
  else select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.prescriptions),(select max(updated_at) from public.ip_tickets),(select max(updated_at) from public.medicine_batches)) into v_value from public.visits v;
 end case;
 return md5(coalesce(v_value,''));
end $$;
revoke all on function public.operational_data_signature() from public;
grant execute on function public.operational_data_signature() to authenticated;
commit;
