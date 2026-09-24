begin;
create function public.get_visit_financial_summaries(p_visit_ids uuid[])
returns table(visit_id uuid,fee_paise bigint,collected_paise bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('admin','reception') then raise exception 'forbidden' using errcode='42501';end if;
 return query select v.id,v.fee_paise,coalesce(sum(p.amount_paise),0)::bigint from public.visits v left join public.visit_payments p on p.visit_id=v.id where v.id=any(p_visit_ids) group by v.id;
end $$;
revoke all on function public.get_visit_financial_summaries(uuid[]) from public;
grant execute on function public.get_visit_financial_summaries(uuid[]) to authenticated;

drop policy if exists visits_read on public.visits;
create policy visits_read on public.visits for select to authenticated using(public.current_app_role() in ('admin','reception','op','ip','doctor'));
drop policy if exists prescriptions_read on public.prescriptions;
create policy prescriptions_read on public.prescriptions for select to authenticated using(public.current_app_role() in ('admin','pharmacy','doctor'));

revoke select on public.visits from authenticated;
grant select(id,patient_id,doctor_id,department_id,visit_type,visit_date,token_number,status,related_previous_visit_id,notes,idempotency_key,created_by,created_at,updated_at) on public.visits to authenticated;
commit;
