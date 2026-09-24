-- The medicine library was the one operational table with no live path.
--
-- Everything else a shift depends on -- visits, vitals, consultations,
-- prescriptions, IP tickets and charges, ward item requests, batches, sales --
-- is published to realtime, watched by OperationalLiveSync and folded into
-- operational_data_signature(). medicine_directory was in none of the three,
-- which did not matter while the only writes were an occasional edit. It
-- matters now that an admin can REMOVE a medicine: until the page was manually
-- reloaded, a doctor's prescribing autocomplete and a ward's request
-- catalogue kept offering something the hospital had just taken out of use.
begin;

do $$
declare t text;
begin
 foreach t in array array['medicine_directory'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;

-- operational_data_signature() is the fallback for a dropped websocket, and it
-- runs per signed-in user. `max(updated_at)` over a directory that a real
-- hospital bulk-imports into the hundreds of thousands would be a sequential
-- scan every time; this index turns it into a one-row backwards index scan
-- whatever the table grows to.
create index if not exists medicine_directory_updated_idx
  on public.medicine_directory (updated_at desc);

-- Same shape as the existing function, with the directory added to every role
-- that can see medicine names or availability on screen: pharmacy and admin
-- manage it, doctors prescribe from it, IP requests items from it, and
-- reception/OP read it on Drug Stock.
create or replace function public.operational_data_signature() returns text language plpgsql stable security definer set search_path='' as $$
declare v_role public.app_role;v_doctor uuid;v_value text;v_medicines timestamptz;
begin
 v_role:=public.current_app_role();v_doctor:=public.current_doctor_id();if v_role is null then raise exception 'forbidden' using errcode='42501';end if;
 select max(updated_at) into v_medicines from public.medicine_directory;
 case v_role
  when 'reception' then select concat_ws('|',max(v.updated_at),(select max(created_at) from public.visit_payments),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.consultations),v_medicines) into v_value from public.visits v;
  when 'op' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.vitals),(select max(updated_at) from public.patient_reports),v_medicines) into v_value from public.visits v;
  when 'doctor' then select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.consultations where doctor_id=v_doctor),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.ip_tickets where doctor_id=v_doctor),v_medicines) into v_value from public.visits v where v.doctor_id=v_doctor;
  when 'ip' then select concat_ws('|',max(t.updated_at),(select max(created_at) from public.ip_charges),(select max(created_at) from public.ip_payments),(select max(updated_at) from public.patient_reports),(select max(greatest(created_at,coalesce(fulfilled_at,created_at))) from public.ip_inventory_requests),v_medicines) into v_value from public.ip_tickets t;
  when 'pharmacy' then select concat_ws('|',max(p.updated_at),(select max(updated_at) from public.medicine_batches),(select max(created_at) from public.pharmacy_sales),(select max(greatest(created_at,coalesce(fulfilled_at,created_at))) from public.ip_inventory_requests),v_medicines) into v_value from public.prescriptions p;
  else select concat_ws('|',max(v.updated_at),(select max(updated_at) from public.patient_reports),(select max(updated_at) from public.prescriptions),(select max(updated_at) from public.ip_tickets),(select max(updated_at) from public.medicine_batches),v_medicines) into v_value from public.visits v;
 end case;
 return md5(coalesce(v_value,''));
end $$;

commit;
