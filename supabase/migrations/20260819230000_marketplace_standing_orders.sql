-- Florisyn Wholesale Marketplace: standing orders.
--
-- The vision doc's STANDING ORDERS section: "Every Monday: 100 Freedom
-- roses, 50 white hydrangeas, 5 bunches eucalyptus... Standing orders
-- are different from blindly repeating ecommerce purchases because
-- fresh-flower availability can change. Design carefully when this
-- phase arrives."
--
-- v1 is deliberately a recurring want-list, not an automatic recurring
-- charge: this table stores what a florist wants and how often, and the
-- buyer UI checks it live (real, fresh price/availability, same as
-- Reorder) whenever they visit the Marketplace on the cadence day —
-- nothing is ever auto-added to a cart or auto-charged. A genuinely
-- proactive push/email reminder would need Netlify Scheduled Functions,
-- which this codebase has never used anywhere; that's a real
-- infrastructure decision deliberately left for a later phase rather
-- than bolted on speculatively here.
create table if not exists public.marketplace_standing_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_shop_id uuid not null references public.shops(id) on delete cascade,
  buyer_user_id uuid not null references auth.users(id) on delete cascade,
  seller_shop_id uuid not null references public.shops(id) on delete cascade,
  label text not null,
  cadence_weekday text not null check (cadence_weekday in ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')),
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_standing_orders_buyer_idx
  on public.marketplace_standing_orders (buyer_user_id, active);

alter table public.marketplace_standing_orders enable row level security;

-- Same ownership shape as marketplace_wholesale_orders' buyer policy —
-- a standing order is entirely the buyer's own, never the seller's to
-- read or edit (the seller only ever sees the resulting real order once
-- the buyer actually places one).
drop policy if exists "marketplace standing orders buyer access" on public.marketplace_standing_orders;
create policy "marketplace standing orders buyer access" on public.marketplace_standing_orders
  for all using (buyer_user_id = auth.uid()) with check (buyer_user_id = auth.uid());

notify pgrst, 'reload schema';
