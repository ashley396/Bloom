-- P0-09D: forward-only hardening for the live function ACL findings.
--
-- Review gate: this migration is intentionally not authorized for hosted apply.
-- It depends on the Florisyn foundation, onboarding, Inventory Pro, and
-- Subscriber Intelligence functions already existing. Apply it only after the
-- full reconciliation order has reproduced those prerequisites on staging.

-- Prevent app-owned functions created by future migrations from becoming RPCs
-- by default. Intentional RPCs must grant EXECUTE explicitly after creation.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Supabase's connected migration role is postgres, which is intentionally not
-- a member of the platform-owned supabase_admin role. PostgreSQL therefore
-- rejects ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin. Keep app-owned
-- functions under postgres and verify supabase_admin defaults separately as a
-- platform configuration/advisor gate; do not make this migration undeployable
-- by attempting an unauthorized cross-role change.

-- These functions are trigger-only. They do not need a direct PostgREST RPC
-- surface for any API role.
revoke all privileges on function public.bloom_subscription_admin_alert()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.bloom_inventory_price_3x()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.touch_updated_at()
  from public, anon, authenticated, service_role;

-- Pin trigger-function name resolution. Both bodies use only pg_catalog
-- routines and explicitly addressed row values.
alter function public.bloom_inventory_price_3x()
  set search_path = pg_catalog, public;
alter function public.touch_updated_at()
  set search_path = pg_catalog, public;

-- Onboarding is an intentional signed-in RPC. Anonymous execution is not part
-- of the application flow and the function rejects a missing auth.uid().
revoke all privileges on function public.complete_florist_onboarding(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_florist_onboarding(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, text, text, text, text
) to authenticated, service_role;

-- RLS helpers must remain callable by signed-in users because policies execute
-- under the caller's role. Anonymous execution is neither required nor desired.
revoke all privileges on function public.user_has_shop_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.user_has_shop_access(uuid)
  to authenticated, service_role;

revoke all privileges on function public.user_is_shop_owner(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.user_is_shop_owner(uuid)
  to authenticated, service_role;

-- Preserve and restate the already-recorded marketplace hardening boundary.
revoke all privileges on function public.is_shop_member(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_shop_member(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
