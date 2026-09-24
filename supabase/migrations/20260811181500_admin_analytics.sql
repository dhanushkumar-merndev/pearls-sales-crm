begin;
create function public.report_admin_overview(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;v_from timestamptz;v_to timestamptz;
begin
 if public.current_app_role()<>'admin' then raise exception 'forbidden' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'invalid date range';end if;
 v_from:=p_from::timestamp at time zone 'Asia/Kolkata';v_to:=(p_to+1)::timestamp at time zone 'Asia/Kolkata';
 select jsonb_build_object(
  'total_visits',(select count(*) from public.visits where visit_date between p_from and p_to),
  'unique_patients',(select count(distinct patient_id) from public.visits where visit_date between p_from and p_to),
  'new_patients',(select count(*) from public.patients where created_at>=v_from and created_at<v_to),
  'op_collected_paise',(select coalesce(sum(p.amount_paise),0) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),
  'ip_collected_paise',(select coalesce(sum(amount_paise),0) from public.ip_payments where created_at>=v_from and created_at<v_to),
  'pharmacy_collected_paise',(select coalesce(sum(total_paise),0) from public.pharmacy_sales where source='op' and created_at>=v_from and created_at<v_to),
  'outstanding_paise',(select greatest(0,coalesce((select sum(fee_paise) from public.visits where visit_date between p_from and p_to),0)-coalesce((select sum(p.amount_paise) from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to),0)+coalesce((select sum(amount_paise) from public.ip_charges where created_at<v_to),0)-coalesce((select sum(amount_paise) from public.ip_payments where created_at<v_to),0))),
  'current_ip',(select count(*) from public.ip_tickets where status in ('admitted','discharge_pending')),
  'visits_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'visits',visits) order by metric_date),'[]'::jsonb) from (select visit_date as metric_date,count(*) as visits from public.visits where visit_date between p_from and p_to group by visit_date) q),
  'collections_by_day',(select coalesce(jsonb_agg(jsonb_build_object('date',metric_date,'op',op,'ip',ip,'pharmacy',pharmacy) order by metric_date),'[]'::jsonb) from (select d.metric_date,coalesce(o.amount,0) op,coalesce(i.amount,0) ip,coalesce(ph.amount,0) pharmacy from (select generate_series(p_from,p_to,'1 day')::date as metric_date)d left join (select v.visit_date as metric_date,sum(p.amount_paise) amount from public.visit_payments p join public.visits v on v.id=p.visit_id where v.visit_date between p_from and p_to group by v.visit_date)o on o.metric_date=d.metric_date left join (select (created_at at time zone 'Asia/Kolkata')::date as metric_date,sum(amount_paise) amount from public.ip_payments where created_at>=v_from and created_at<v_to group by 1)i on i.metric_date=d.metric_date left join (select (created_at at time zone 'Asia/Kolkata')::date as metric_date,sum(total_paise) amount from public.pharmacy_sales where source='op' and created_at>=v_from and created_at<v_to group by 1)ph on ph.metric_date=d.metric_date)q),
  'visits_by_doctor',(select coalesce(jsonb_agg(jsonb_build_object('doctor',display_name,'visits',visits) order by visits desc),'[]'::jsonb) from (select d.display_name,count(*) visits from public.visits v join public.doctors d on d.id=v.doctor_id where v.visit_date between p_from and p_to group by d.id,d.display_name order by visits desc limit 15)q),
  'ip_by_category',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'amount_paise',amount) order by amount desc),'[]'::jsonb) from (select category,sum(amount_paise) amount from public.ip_charges where created_at>=v_from and created_at<v_to group by category)q),
  'top_medicines',(select coalesce(jsonb_agg(jsonb_build_object('medicine',medicine_name,'quantity',quantity) order by quantity desc),'[]'::jsonb) from (select pi.medicine_name,sum(si.quantity) quantity from public.pharmacy_sale_items si join public.prescription_items pi on pi.id=si.prescription_item_id join public.pharmacy_sales s on s.id=si.sale_id where s.created_at>=v_from and s.created_at<v_to group by pi.medicine_name order by quantity desc limit 10)q)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.report_admin_overview(date,date) from public;
grant execute on function public.report_admin_overview(date,date) to authenticated;
commit;
