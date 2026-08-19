-- Marketplace "multiple permissive policies" advisor findings (31 total,
-- collapsing to 8 distinct policy pairs once role/action fan-out is
-- removed). Each pair was checked individually — for PERMISSIVE
-- policies, Postgres always ORs every applicable policy together for a
-- given role+command, so merging two permissive policies covering the
-- EXACT SAME command scope into one policy with an OR'd predicate is
-- mathematically identical, zero security change. But merging is only
-- safe when both policies really do cover the same command scope.
--
-- Of the 8 pairs, only ONE qualifies:
--
--   marketplace_verification_applications: "owner access" (FOR ALL) +
--   "service role access" (FOR ALL) — both apply to every command
--   (SELECT/INSERT/UPDATE/DELETE) uniformly, so merging is a pure,
--   safe performance win. Done below.
--
-- The other 7 pairs are a DIFFERENT shape and were deliberately left
-- alone — see the doc comment further down for why merging any of them
-- would be a real regression, not a no-op.

drop policy if exists "marketplace applications owner access" on public.marketplace_verification_applications;
drop policy if exists "marketplace applications service role access" on public.marketplace_verification_applications;
create policy "marketplace applications owner or service role access" on public.marketplace_verification_applications
for all using (
  ((select auth.uid()) = user_id)
  or ((select auth.role()) = 'service_role')
) with check (
  ((select auth.uid()) = user_id)
  or ((select auth.role()) = 'service_role')
);

-- =====================================================================
-- The other 7 pairs — deliberately NOT merged. Each is shaped like:
--   * a SELECT-only "browse"/"read" policy with a narrow, buyer-facing
--     condition (e.g. active listings only, or the caller's own
--     favorites), and
--   * a separate FOR ALL "shop access" policy granting the row's owner
--     full CRUD on their own rows regardless of that narrow condition
--     (e.g. a seller must see and edit their own DRAFT listings, which
--     the public browse condition would hide).
--
-- Combining them into one policy would have to pick one of two broken
-- outcomes:
--   1. Fold the browse condition into the FOR ALL policy's USING clause
--      — this doesn't just add a redundant SELECT path, it extends
--      UPDATE/DELETE reach to whoever satisfies the browse condition
--      (e.g. a random authenticated buyer could then target any active
--      listing for UPDATE/DELETE, not just their own rows). A real
--      privilege escalation, not a performance no-op.
--   2. Narrow the FOR ALL policy to exclude SELECT (FOR INSERT, UPDATE,
--      DELETE) and rely on the browse policy alone for SELECT — but the
--      browse policy's condition is strictly narrower than "this is my
--      own row" (it hides drafts/inactive/archived rows, future-dated
--      promotions, etc.), so the owner would lose the ability to see
--      their own not-yet-live rows. A real functional regression.
--
-- pairs, left as-is:
--   marketplace_listing_images:   "images browse" + "images shop access"
--   marketplace_listing_variants: "variants browse" + "variants shop access"
--   marketplace_listings:         "active listings browse" + "shop access"
--   marketplace_promotions:       "promotions buyer read" + "promotions shop access"
--   marketplace_seller_categories:"seller categories read" + "seller categories shop access"
--   marketplace_seller_profiles:  "seller profile public read" + "seller profile shop access"
--   marketplace_wholesale_orders: "wholesale orders buyer read" + "wholesale orders seller access"
--
-- The advisor's generic "combine multiple permissive policies"
-- suggestion doesn't account for this shape — it's a valid lint for
-- accidental duplication, not for this intentional layered-visibility
-- pattern. No SQL change for these 7; this migration exists to record
-- the decision so it isn't silently "fixed" into a regression later.

notify pgrst, 'reload schema';
