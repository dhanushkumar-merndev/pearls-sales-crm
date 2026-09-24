-- save_visit_consultation gained three admission params in 20260815130000
-- via a signature change, which CREATE OR REPLACE cannot fold into the
-- existing function -- it silently added a second overload instead of
-- replacing the first. The app always sends all 16 params so it never hit
-- this, but PostgREST rejects any 12/13-arg call as ambiguous between the
-- two, and it's a stale, unreachable-as-intended definition either way.
begin;

drop function if exists public.save_visit_consultation(
  uuid, text, text, text, text, text, public.follow_up_type, date, integer, jsonb, jsonb, boolean, bigint
);

commit;
