-- Same bug class as 20260819320000 (florist_community_follows/notifications):
-- these five tables were created with RLS enabled and policies attached, but
-- the underlying table-level GRANTs were never added. RLS policies only
-- filter rows *after* the coarse-grained GRANT already permits the
-- operation — without it every query fails with "permission denied for
-- table ...", which surfaces to the florist/admin as a flat, unhelpful
-- "Unexpected Florisyn error. Try again or contact support." (marked
-- confirmed live via a 403 from PostgREST on marketplace_notifications, seen
-- in Supabase edge_logs while marketplace-catalog?resource=notifications was
-- failing for a real florist).
--
-- Live impact:
--   marketplace_notifications  — marketplace-catalog?resource=notifications
--                                (every florist's marketplace notification bell)
--   marketplace_seller_reviews — buyer review read/insert on seller storefronts
--   marketplace_standing_orders — buyer standing-order CRUD
--   florist_wire_ratings       — Florist Network wire-service ratings
--   platform_library_photos    — had ZERO policies and ZERO grants at all
--                                (RLS enabled, no policy = deny-all even for
--                                service_role, since service_role's RLS
--                                bypass does not skip the GRANT check) —
--                                broke admin-photo-manager.js's "Current
--                                photos" list/upload entirely since it was
--                                created.

grant select, update on table public.marketplace_notifications to authenticated;
grant all on table public.marketplace_notifications to service_role;

grant select, insert on table public.marketplace_seller_reviews to authenticated;
grant all on table public.marketplace_seller_reviews to service_role;

grant select, insert, update, delete on table public.marketplace_standing_orders to authenticated;
grant all on table public.marketplace_standing_orders to service_role;

grant select, insert on table public.florist_wire_ratings to authenticated;
grant all on table public.florist_wire_ratings to service_role;

-- Admin-only table (no authenticated-facing RLS policy exists or is needed —
-- every read/write goes through admin-photo-manager.js's service-role client).
grant all on table public.platform_library_photos to service_role;
