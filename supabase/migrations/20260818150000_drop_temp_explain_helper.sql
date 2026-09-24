-- Removes the temporary diagnostic added in 20260818140000 once its purpose
-- (verifying the query-optimization pass) was served. Not needed in the
-- running app; kept out of the permanent surface.
begin;
drop function if exists public.debug_explain(text);
commit;
