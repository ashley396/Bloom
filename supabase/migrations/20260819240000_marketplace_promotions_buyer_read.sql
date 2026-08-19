-- Wholesale Marketplace vision: "Marketplace Specials." marketplace_promotions
-- has existed since the greenfield baseline with real columns (code,
-- percent_off, active, starts_at, ends_at) but was dormant end-to-end: no
-- seller action ever created a row, and its only RLS policy
-- ("marketplace promotions shop access") is shop-membership-scoped, so even
-- a buyer with a real row to read could never see one. This migration adds
-- exactly the buyer-read policy the buyer catalog's own "marketplace active
-- listings browse" policy already uses as its template — same shape, same
-- authenticated-read-only-what's-actually-live semantics, no new table.
--
-- The date-window check happens twice, by design: here in RLS (so a lapsed
-- or not-yet-started promo is never even queryable by a buyer's own
-- session) and again in application code via isPromotionActive() (used by
-- checkout, which needs to re-validate at the moment of use, not just at
-- browse time, the same "never assume last week's price/availability is
-- still valid" discipline applied throughout this rollout).
drop policy if exists "marketplace promotions buyer read" on public.marketplace_promotions;
create policy "marketplace promotions buyer read" on public.marketplace_promotions
for select to authenticated
using (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

notify pgrst, 'reload schema';
