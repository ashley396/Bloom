-- Wholesale Marketplace vision: volume pricing. marketplace_pricing_tiers
-- has existed since the greenfield baseline with real columns (name,
-- min_quantity, discount_percent, active) and the seller dashboard's
-- "Pricing" tab has always let a seller create real rows — but the table's
-- only RLS policy ("marketplace pricing tiers shop access") is
-- shop-membership-scoped, so even a fully-configured tier could never be
-- read by a buyer checking out from that seller. Checkout runs as the
-- buyer's own authenticated session (never service_role), so without this
-- policy the new tier lookup added in marketplace-checkout.js would
-- silently see zero rows and every volume discount would still never
-- apply — same dormant-infrastructure shape as marketplace_promotions
-- before 20260819240000_marketplace_promotions_buyer_read.sql, same fix:
-- add exactly the buyer-read policy, same authenticated-read-only-what's-
-- active semantics, no new table.
drop policy if exists "marketplace pricing tiers buyer read" on public.marketplace_pricing_tiers;
create policy "marketplace pricing tiers buyer read" on public.marketplace_pricing_tiers
for select to authenticated
using (active = true);

notify pgrst, 'reload schema';
