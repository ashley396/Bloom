-- Fix: 20260819160000 created florist_community_follows and
-- florist_community_notifications with RLS enabled and policies attached,
-- but never granted the underlying table privileges to authenticated (or
-- service_role). RLS policies only filter rows *after* the coarse-grained
-- GRANT already permits the operation — without it every query fails with
-- "permission denied for table ...", which is not a "missing relation"
-- error, so it wasn't swallowed by missingRelation() in
-- florist-community.js and instead threw all the way up to a 500.
--
-- Live impact: every GET /florist-community?action=feed call runs
-- loadFollowingSet() unconditionally (regardless of post count), so this
-- broke the Community feed for every florist, surfacing as "Unexpected
-- Florisyn error. Try again or contact support."

grant select, insert, delete on table public.florist_community_follows to authenticated;
grant all on table public.florist_community_follows to service_role;

grant select, update on table public.florist_community_notifications to authenticated;
grant all on table public.florist_community_notifications to service_role;
