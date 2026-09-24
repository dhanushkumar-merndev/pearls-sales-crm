-- IP -> pharmacy inventory requests (20260817100000_ip_inventory_requests.sql)
-- were never wired into the realtime path: not in the supabase_realtime
-- publication, and not counted by operational_data_signature(). Pharmacy
-- never learned a request existed, and IP never learned it was fulfilled,
-- until someone manually reloaded the page. Bring this handoff in line with
-- every other operational table (visits, ip_tickets, prescriptions, ...).
begin;

do $$
declare t text;
begin
 foreach t in array array['ip_inventory_requests','ip_inventory_request_items'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;

-- ip_inventory_requests has no updated_at column, only created_at (request
-- raised) and fulfilled_at (request closed) -- both change under this row,
-- so greatest() of the two catches either event for the fallback poll.
create or replace function public.operational_data_signature() returns text language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;v_value text;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null then raise exception 'forbidden' using errcode='42501';end if;
 case v_role
  when 'reception' then select concat_ws('|',max(v.updated_at),(select max(created_at) from public.visit_payments),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.consultations)) into v_value from public.visits v;
  when 'op' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.vitals),(select max(updated_at) from public.patient_reports)) into v_value from public.visits v;
  when 'doctor' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.consultations where doctor_id=v_doctor),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.ip_tickets where doctor_id=v_doctor)) into v_value from public.visits v where v.doctor_id=v_doctor;
  when 'ip' then select concat_ws('|',max(t.updated_at),(select max(created_at) from public.ip_charges),(select max(created_at) from public.ip_payments),(select max(updated_at) from public.patient_reports),(select max(greatest(created_at,coalesce(fulfilled_at,created_at))) from public.ip_inventory_requests)) into v_value from public.ip_tickets t;
  when 'pharmacy' then select concat_ws('|',max(p.updated_at),(select max(updated_at) from public.medicine_batches),(select max(created_at) from public.pharmacy_sales),(select max(greatest(created_at,coalesce(fulfilled_at,created_at))) from public.ip_inventory_requests)) into v_value from public.prescriptions p;
  else select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.prescriptions),(select max(updated_at) from public.ip_tickets),(select max(updated_at) from public.medicine_batches)) into v_value from public.visits v;
 end case;
 return md5(coalesce(v_value,''));
end $$;

commit;
