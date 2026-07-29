-- Bloom RC1.2 — storefront commerce settings (review only, idempotent).

alter table public.bloom_website_projects
  add column if not exists commerce_settings jsonb not null default '{}'::jsonb;

comment on column public.bloom_website_projects.commerce_settings is
  'Public storefront commerce: pay_now, deposits, lead times, delivery fees.';

create table if not exists public.bloom_storefront_order_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bloom_storefront_order_events_shop_idx
  on public.bloom_storefront_order_events (shop_id, created_at desc);

alter table public.bloom_storefront_order_events enable row level security;

drop policy if exists "storefront order events shop" on public.bloom_storefront_order_events;
create policy "storefront order events shop" on public.bloom_storefront_order_events
for select using (public.is_shop_member(shop_id));
