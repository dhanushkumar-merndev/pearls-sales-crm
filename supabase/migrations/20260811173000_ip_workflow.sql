begin;
alter table public.ip_tickets add column idempotency_key uuid unique;

create function public.create_ip_ticket(p_patient_id uuid,p_doctor_id uuid,p_source_visit_id uuid,p_room text,p_bed text,p_reason text,p_deposit_paise bigint,p_payment_mode public.payment_mode,p_idempotency_key uuid)
returns table(ticket_id uuid,ticket_number text) language plpgsql security definer set search_path='' as $$
declare v_role public.app_role;v_id uuid;v_number text;
begin
 v_role:=public.current_app_role();if v_role not in ('admin','ip') then raise exception 'forbidden' using errcode='42501';end if;
 select id,ip_tickets.ticket_number into v_id,v_number from public.ip_tickets where idempotency_key=p_idempotency_key;if v_id is not null then return query select v_id,v_number;return;end if;
 if p_deposit_paise<0 then raise exception 'invalid deposit';end if;
 v_number:='IP-'||to_char((now() at time zone 'Asia/Kolkata'),'YYYY')||'-'||lpad(nextval('public.ip_ticket_sequence')::text,6,'0');
 insert into public.ip_tickets(ticket_number,patient_id,doctor_id,source_visit_id,room,bed,admission_reason,idempotency_key) values(v_number,p_patient_id,p_doctor_id,p_source_visit_id,p_room,p_bed,p_reason,p_idempotency_key) returning id into v_id;
 if p_deposit_paise>0 then insert into public.ip_payments(ip_ticket_id,amount_paise,mode,idempotency_key) values(v_id,p_deposit_paise,p_payment_mode,p_idempotency_key);end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id) values(auth.uid(),'IP_ADMITTED','ip_ticket',v_id);
 return query select v_id,v_number;
end $$;
revoke all on function public.create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,public.payment_mode,uuid) from public;
grant execute on function public.create_ip_ticket(uuid,uuid,uuid,text,text,text,bigint,public.payment_mode,uuid) to authenticated;
commit;
