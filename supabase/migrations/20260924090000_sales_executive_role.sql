-- Pearl Aesthetic CRM: the Sales Executive role works Meta / manual leads.
--
-- A new enum value cannot be used in the same transaction that adds it, so it
-- lives in its own migration ahead of everything that references it.
alter type public.app_role add value if not exists 'sales_executive';
