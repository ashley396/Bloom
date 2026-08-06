-- Bloom Wholesale 1.0 seller platform (forward-only, idempotent). Review before apply.

alter table public.marketplace_listings
  add column if not exists publish_status text not null default 'published';

alter table public.marketplace_listings
  add column if not exists published_at timestamptz;

alter table public.marketplace_listings
  add column if not exists preview_updated_at timestamptz;

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_publish_status_check;

alter table public.marketplace_listings
  add constraint marketplace_listings_publish_status_check
  check (publish_status in ('draft', 'preview', 'published'));

create table if not exists public.marketplace_listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_listing_images_listing_idx
  on public.marketplace_listing_images (listing_id, sort_order);

create table if not exists public.marketplace_listing_variants (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  sku text,
  name text not null,
  price numeric(12,2) not null default 0,
  available_quantity numeric(12,2) not null default 0,
  low_stock_threshold numeric(12,2) default 5,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_listing_variants_listing_idx
  on public.marketplace_listing_variants (listing_id);

create unique index if not exists marketplace_listing_variants_shop_sku_idx
  on public.marketplace_listing_variants (shop_id, sku)
  where sku is not null and sku <> '';

create table if not exists public.marketplace_wholesale_customers (
  id uuid primary key default gen_random_uuid(),
  seller_shop_id uuid not null references public.shops(id) on delete cascade,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_wholesale_customers_shop_idx
  on public.marketplace_wholesale_customers (seller_shop_id);

create table if not exists public.marketplace_wholesale_orders (
  id uuid primary key default gen_random_uuid(),
  seller_shop_id uuid not null references public.shops(id) on delete cascade,
  buyer_shop_id uuid references public.shops(id) on delete set null,
  buyer_user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references public.marketplace_wholesale_customers(id) on delete set null,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'paid', 'fulfilled', 'completed', 'cancelled')
  ),
  total numeric(12,2) not null default 0,
  items jsonb not null default '[]'::jsonb,
  shipping_profile_id uuid references public.marketplace_shipping_profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_wholesale_orders_seller_idx
  on public.marketplace_wholesale_orders (seller_shop_id, created_at desc);

alter table public.marketplace_listing_images enable row level security;
alter table public.marketplace_listing_variants enable row level security;
alter table public.marketplace_wholesale_customers enable row level security;
alter table public.marketplace_wholesale_orders enable row level security;

drop policy if exists "marketplace listing images shop access" on public.marketplace_listing_images;
create policy "marketplace listing images shop access" on public.marketplace_listing_images
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace listing images browse" on public.marketplace_listing_images;
create policy "marketplace listing images browse" on public.marketplace_listing_images
for select to authenticated using (true);

drop policy if exists "marketplace listing variants shop access" on public.marketplace_listing_variants;
create policy "marketplace listing variants shop access" on public.marketplace_listing_variants
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace listing variants browse" on public.marketplace_listing_variants;
create policy "marketplace listing variants browse" on public.marketplace_listing_variants
for select to authenticated using (true);

drop policy if exists "marketplace wholesale customers shop access" on public.marketplace_wholesale_customers;
create policy "marketplace wholesale customers shop access" on public.marketplace_wholesale_customers
for all using (public.is_shop_member(seller_shop_id)) with check (public.is_shop_member(seller_shop_id));

drop policy if exists "marketplace wholesale orders seller access" on public.marketplace_wholesale_orders;
create policy "marketplace wholesale orders seller access" on public.marketplace_wholesale_orders
for all using (public.is_shop_member(seller_shop_id)) with check (public.is_shop_member(seller_shop_id));

drop policy if exists "marketplace wholesale orders buyer read" on public.marketplace_wholesale_orders;
create policy "marketplace wholesale orders buyer read" on public.marketplace_wholesale_orders
for select using (buyer_user_id = auth.uid());

notify pgrst, 'reload schema';
