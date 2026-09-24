begin;
do $$
declare t text;
begin
 foreach t in array array['visits','visit_payments','vitals','consultations','patient_reports','prescriptions','ip_tickets','ip_charges','ip_payments','medicine_batches','pharmacy_sales'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
commit;
