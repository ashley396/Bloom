-- Florisyn Wholesale Marketplace: payment/checkout hardening, phase 1.
--
-- The vision doc treats marketplace payments as their own dedicated
-- high-risk engineering phase and explicitly warns against modifying
-- Florisyn's existing payment system casually. This migration does not
-- add any money-moving capability — it only gives the order record a
-- honest vocabulary for two things that can genuinely happen to a paid
-- order (a refund, a card-network dispute) so they can be tracked
-- instead of leaving the order frozen at "paid" forever. Refund
-- *execution* stays on Stripe's own Express Connect dashboard (already
-- reachable via stripe-connect.js's existing login-link action) — this
-- schema only tracks what Stripe reports happened, and what a buyer has
-- asked a seller to look into.
alter table public.marketplace_wholesale_orders drop constraint if exists marketplace_wholesale_orders_status_check;
alter table public.marketplace_wholesale_orders add constraint marketplace_wholesale_orders_status_check
  check (status in ('pending', 'processing', 'paid', 'fulfilled', 'completed', 'cancelled', 'refunded', 'disputed'));

alter table public.marketplace_wholesale_orders add column if not exists refund_requested_at timestamptz;
alter table public.marketplace_wholesale_orders add column if not exists refund_requested_reason text;
alter table public.marketplace_wholesale_orders add column if not exists refunded_amount numeric(12,2);
alter table public.marketplace_wholesale_orders add column if not exists refunded_at timestamptz;
alter table public.marketplace_wholesale_orders add column if not exists disputed_at timestamptz;

-- A buyer requesting a refund is a real event a seller needs to see —
-- same notifications table and pattern as order_status_changed/
-- back_in_stock, just one more real type.
alter table public.marketplace_notifications drop constraint if exists marketplace_notifications_type_check;
alter table public.marketplace_notifications add constraint marketplace_notifications_type_check
  check (type in ('order_status_changed', 'back_in_stock', 'refund_requested'));

