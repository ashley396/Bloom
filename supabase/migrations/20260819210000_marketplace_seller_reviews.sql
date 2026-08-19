-- Florisyn Wholesale Marketplace: reviews tied to a real completed
-- transaction, never a free-for-all rating system. The vision doc is
-- explicit: "reviews must be tied to legitimate transactions where
-- possible... do not build an easily manipulated rating system."
--
-- Enforced two ways: a unique order_id (exactly one review per order,
-- ever — no review-bombing the same purchase repeatedly) and an RLS
-- INSERT check that the reviewing user actually is that order's buyer,
-- for that exact seller, and the order reached a real paid state. There
-- is deliberately no UPDATE/DELETE policy — a review is immutable once
-- posted, so a seller can't pressure a buyer into softening it and a
-- buyer can't quietly delete a bad review after the fact.
create table if not exists public.marketplace_seller_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.marketplace_wholesale_orders(id) on delete cascade,
  seller_shop_id uuid not null references public.shops(id) on delete cascade,
  buyer_user_id uuid not null references auth.users(id) on delete cascade,
  buyer_shop_id uuid references public.shops(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  fulfillment_rating integer check (fulfillment_rating between 1 and 5),
  communication_rating integer check (communication_rating between 1 and 5),
  accuracy_rating integer check (accuracy_rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_seller_reviews_seller_idx
  on public.marketplace_seller_reviews (seller_shop_id, created_at desc);

alter table public.marketplace_seller_reviews enable row level security;

-- Reviews are a public trust signal — any authenticated florist
-- evaluating a seller can read them, same as marketplace_listings itself.
drop policy if exists "marketplace seller reviews public read" on public.marketplace_seller_reviews;
create policy "marketplace seller reviews public read" on public.marketplace_seller_reviews
  for select using (auth.uid() is not null);

drop policy if exists "marketplace seller reviews buyer insert" on public.marketplace_seller_reviews;
create policy "marketplace seller reviews buyer insert" on public.marketplace_seller_reviews
  for insert with check (
    buyer_user_id = auth.uid()
    and exists (
      select 1 from public.marketplace_wholesale_orders o
      where o.id = order_id
        and o.buyer_user_id = auth.uid()
        and o.seller_shop_id = seller_shop_id
        and o.status in ('paid', 'fulfilled', 'completed')
    )
  );

notify pgrst, 'reload schema';
