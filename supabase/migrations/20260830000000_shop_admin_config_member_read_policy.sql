-- Florist-Facing Marketing Studio + Lily Connected Intelligence pass —
-- Phase 1/2 finding, NOT YET APPLIED to any environment. Draft only; apply
-- separately once Ashley authorizes a production migration for this phase.
--
-- shop_admin_config has had row-level security ENABLED but ZERO policies
-- for the `authenticated` role since it was created
-- (20260804000000_greenfield_baseline.sql, "No client policies: Command
-- Center access is service-role only"). That was a deliberate choice for
-- WRITES (theme/navigation/features/content are only ever edited through
-- admin-console.js's save_config action, itself gated by platformAdmin())
-- — but it silently also blocked every real florist session's own READ of
-- their own shop's config row, because no `authenticated` grant or policy
-- existed at all, not even a shop-scoped one. tenant-config.js has been
-- querying this table with a real member-scoped client since it was
-- written and has always silently gotten nothing back for a real florist
-- session — a genuine, previously-latent production defect, not a
-- regression this pass introduces.
--
-- This migration is deliberately narrow: SELECT only, still gated by the
-- same public.is_shop_member(shop_id) helper every other shop-scoped
-- table's RLS policy already uses, and it changes NOTHING about writes —
-- those remain service-role-only via admin-console.js exactly as before.
-- A shop's own active member may now read their own shop_admin_config row
-- (theme/navigation/features/content/account_status/support_message/
-- announcement) and nothing else's.
--
-- This does NOT, by itself, make Marketing Studio's private-beta flag
-- readable through tenant-config.js's existing endpoint — marketing-
-- studio-shop.js's own beta gate (isShopFeatureEnabled(), Phase 2)
-- already reads this table server-side via a service-role client
-- specifically because this policy did not exist yet, so Phase 1/2's own
-- correctness does not depend on this migration being applied. This is
-- included as a real, independently valuable fix for tenant-config.js's
-- own read path, found while auditing this table for Phase 1.

drop policy if exists "shop admin config member read" on public.shop_admin_config;
create policy "shop admin config member read"
  on public.shop_admin_config
  for select
  to authenticated
  using ((select public.is_shop_member(shop_id)));

grant select on table public.shop_admin_config to authenticated;
