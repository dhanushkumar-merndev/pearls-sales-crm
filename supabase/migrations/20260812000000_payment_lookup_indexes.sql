begin;

-- Payment and balance validation performs these lookups for every write.
-- Without the parent indexes, bulk imports and busy reception/IP workflows
-- degrade into repeated table scans.
create index if not exists visit_payments_visit_idx
  on public.visit_payments(visit_id);

create index if not exists ip_charges_ticket_idx
  on public.ip_charges(ip_ticket_id);

create index if not exists ip_payments_ticket_idx
  on public.ip_payments(ip_ticket_id);

create index if not exists pharmacy_sales_prescription_idx
  on public.pharmacy_sales(prescription_id);

commit;
