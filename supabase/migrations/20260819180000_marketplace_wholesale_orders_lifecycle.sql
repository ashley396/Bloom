-- Fix a silent production bug in the Wholesale Marketplace order pipeline,
-- then add the columns needed to track an order through to receipt.
--
-- marketplace-checkout.js has always inserted `listing_id` and `metadata`
-- on marketplace_wholesale_orders, and stripe-order-webhook.js has always
-- updated `paid_at` + `metadata` when a checkout session completes — but
-- none of those columns exist on the table. Both writes are wrapped in
-- try/catch and only console.warn on failure, so every wholesale order has
-- been silently failing to insert (or, if inserted before this bug,
-- silently failing to ever move past "pending_payment") since the feature
-- shipped. This migration adds the missing columns; it changes no
-- behavior for any other table.
alter table public.marketplace_wholesale_orders add column if not exists listing_id uuid references public.marketplace_listings(id) on delete set null;
alter table public.marketplace_wholesale_orders add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.marketplace_wholesale_orders add column if not exists paid_at timestamptz;

-- New lifecycle columns for buyer-side order receipt: a florist marks a
-- paid order received and (optionally, explicitly) brings its line items
-- into their own shop inventory. inventory_synced_at guards against
-- applying that inventory receipt twice.
alter table public.marketplace_wholesale_orders add column if not exists fulfilled_at timestamptz;
alter table public.marketplace_wholesale_orders add column if not exists received_at timestamptz;
alter table public.marketplace_wholesale_orders add column if not exists inventory_synced_at timestamptz;

create index if not exists marketplace_wholesale_orders_buyer_idx
  on public.marketplace_wholesale_orders (buyer_user_id, created_at desc);
