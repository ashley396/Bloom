-- Marketplace RLS/performance cleanup. Every change here is either a pure
-- query-plan optimization (auth.uid()/auth.role() re-wrapped in a scalar
-- subselect so Postgres evaluates it once per statement instead of once
-- per row — see https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)
-- or a purely additive covering index on an existing foreign key. No
-- policy's actual authorization logic changes as part of the perf pass —
-- same predicate, same rows allowed, just evaluated cheaper.
--
-- The one exception, called out on its own below: "marketplace seller
-- reviews buyer insert" had a real logic bug (not a performance issue)
-- that surfaced only while re-reading these policies closely enough to
-- rewrap them. Fixed in the same statement since touching this exact
-- policy twice in two migrations would be its own kind of churn.

-- =====================================================================
-- PART 1: auth_rls_initplan — wrap auth.<fn>() in (select ...)
-- =====================================================================

drop policy if exists "marketplace applications owner access" on public.marketplace_verification_applications;
create policy "marketplace applications owner access" on public.marketplace_verification_applications
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "marketplace applications service role access" on public.marketplace_verification_applications;
create policy "marketplace applications service role access" on public.marketplace_verification_applications
for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "marketplace verification tax secrets service role" on public.marketplace_verification_tax_secrets;
create policy "marketplace verification tax secrets service role" on public.marketplace_verification_tax_secrets
for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "marketplace verification audit service role" on public.marketplace_verification_audit_events;
create policy "marketplace verification audit service role" on public.marketplace_verification_audit_events
for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "marketplace verification email service role" on public.marketplace_verification_email_outbox;
create policy "marketplace verification email service role" on public.marketplace_verification_email_outbox
for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "marketplace favorites owner access" on public.marketplace_favorites;
create policy "marketplace favorites owner access" on public.marketplace_favorites
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "marketplace wholesale orders buyer read" on public.marketplace_wholesale_orders;
create policy "marketplace wholesale orders buyer read" on public.marketplace_wholesale_orders
for select using (buyer_user_id = (select auth.uid()));

drop policy if exists "marketplace notifications select own" on public.marketplace_notifications;
create policy "marketplace notifications select own" on public.marketplace_notifications
  for select using (recipient_user_id = (select auth.uid()));

drop policy if exists "marketplace notifications mark read" on public.marketplace_notifications;
create policy "marketplace notifications mark read" on public.marketplace_notifications
  for update using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

drop policy if exists "marketplace seller reviews public read" on public.marketplace_seller_reviews;
create policy "marketplace seller reviews public read" on public.marketplace_seller_reviews
  for select using ((select auth.uid()) is not null);

drop policy if exists "marketplace standing orders buyer access" on public.marketplace_standing_orders;
create policy "marketplace standing orders buyer access" on public.marketplace_standing_orders
  for all using (buyer_user_id = (select auth.uid())) with check (buyer_user_id = (select auth.uid()));

-- "marketplace seller reviews buyer insert" — perf fix AND a real logic
-- bug fix. The original WITH CHECK read:
--   ... and o.seller_shop_id = seller_shop_id
-- intending the unqualified `seller_shop_id` to mean "the new review
-- row's seller_shop_id" (marketplace_seller_reviews.seller_shop_id). But
-- inside the correlated subquery `select 1 from marketplace_wholesale_orders o
-- where ...`, Postgres resolves an unqualified column name against the
-- CLOSEST enclosing scope first — and `o` (marketplace_wholesale_orders)
-- also has its own seller_shop_id column. So the unqualified reference
-- silently bound to `o.seller_shop_id`, making the clause
-- `o.seller_shop_id = o.seller_shop_id`: a self-referential tautology,
-- always true. pg_policies confirms this is exactly how Postgres itself
-- parsed and stored it. The real intent — "the review's seller_shop_id
-- must match the order's actual seller" — was never enforced at the
-- database layer.
--
-- Not currently exploitable through the app itself: submitSellerReview()
-- in marketplace-catalog.js always derives seller_shop_id server-side
-- from the real fetched order row (order.seller_shop_id), never from
-- client input, so the app's own write path was already safe. But RLS
-- exists precisely as the layer that stays correct even if application
-- code doesn't — a direct PostgREST call with a valid buyer JWT could
-- have inserted a review row misattributed to any seller_shop_id,
-- bypassed by this shadowing bug. Fixed by fully qualifying the column.
drop policy if exists "marketplace seller reviews buyer insert" on public.marketplace_seller_reviews;
create policy "marketplace seller reviews buyer insert" on public.marketplace_seller_reviews
  for insert with check (
    buyer_user_id = (select auth.uid())
    and exists (
      select 1 from public.marketplace_wholesale_orders o
      where o.id = order_id
        and o.buyer_user_id = (select auth.uid())
        and o.seller_shop_id = marketplace_seller_reviews.seller_shop_id
        and o.status in ('paid', 'fulfilled', 'completed')
    )
  );

-- =====================================================================
-- PART 2: unindexed_foreign_keys — purely additive covering indexes
-- =====================================================================

create index if not exists marketplace_favorites_listing_id_idx on public.marketplace_favorites (listing_id);
create index if not exists marketplace_listing_images_shop_id_idx on public.marketplace_listing_images (shop_id);
create index if not exists marketplace_notifications_listing_id_idx on public.marketplace_notifications (listing_id);
create index if not exists marketplace_notifications_order_id_idx on public.marketplace_notifications (order_id);
create index if not exists marketplace_seller_categories_category_slug_idx on public.marketplace_seller_categories (category_slug);
create index if not exists marketplace_seller_reviews_buyer_shop_id_idx on public.marketplace_seller_reviews (buyer_shop_id);
create index if not exists marketplace_seller_reviews_buyer_user_id_idx on public.marketplace_seller_reviews (buyer_user_id);
create index if not exists marketplace_standing_orders_buyer_shop_id_idx on public.marketplace_standing_orders (buyer_shop_id);
create index if not exists marketplace_standing_orders_seller_shop_id_idx on public.marketplace_standing_orders (seller_shop_id);
create index if not exists marketplace_verification_audit_actor_user_id_idx on public.marketplace_verification_audit_events (actor_user_id);
create index if not exists marketplace_verification_email_outbox_application_id_idx on public.marketplace_verification_email_outbox (application_id);
create index if not exists marketplace_verification_email_outbox_user_id_idx on public.marketplace_verification_email_outbox (user_id);
create index if not exists marketplace_verification_tax_secrets_user_id_idx on public.marketplace_verification_tax_secrets (user_id);
create index if not exists marketplace_wholesale_orders_buyer_shop_id_idx on public.marketplace_wholesale_orders (buyer_shop_id);
create index if not exists marketplace_wholesale_orders_customer_id_idx on public.marketplace_wholesale_orders (customer_id);
create index if not exists marketplace_wholesale_orders_listing_id_idx on public.marketplace_wholesale_orders (listing_id);
create index if not exists marketplace_wholesale_orders_shipping_profile_id_idx on public.marketplace_wholesale_orders (shipping_profile_id);

notify pgrst, 'reload schema';
