-- Bloom Marketplace milestone v2 (forward-only, idempotent). Review before apply.

create table if not exists public.marketplace_category_catalog (
  slug text primary key,
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

insert into public.marketplace_category_catalog (slug, label, sort_order)
values
  ('fresh-flowers', 'Fresh Flowers', 10),
  ('artificial-florals', 'Artificial Florals', 20),
  ('greenery', 'Greenery', 30),
  ('floral-supplies', 'Floral Supplies', 40),
  ('ribbon', 'Ribbon', 50),
  ('vases-containers', 'Vases & Containers', 60),
  ('plants-garden', 'Plants & Garden', 70),
  ('balloons', 'Balloons', 80),
  ('gifts', 'Gifts', 90),
  ('candles', 'Candles', 100),
  ('chocolates-gourmet', 'Chocolates & Gourmet', 110),
  ('plush', 'Plush', 120),
  ('sympathy-gifts', 'Sympathy Gifts', 130),
  ('boutique-apparel', 'Boutique & Apparel', 140),
  ('jewelry-accessories', 'Jewelry & Accessories', 150),
  ('home-decor', 'Home Décor', 160),
  ('wedding-event', 'Wedding & Event', 170),
  ('holiday-seasonal', 'Holiday & Seasonal', 180),
  ('printing-packaging', 'Printing & Packaging', 190),
  ('delivery-business-supplies', 'Delivery & Business Supplies', 200)
on conflict (slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  active = excluded.active;

create table if not exists public.marketplace_seller_profiles (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  display_name text,
  storefront_slug text,
  bio text,
  website text,
  verified_at timestamptz,
  minimum_order_amount numeric(12,2) default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketplace_seller_profiles_slug_idx
  on public.marketplace_seller_profiles (storefront_slug)
  where storefront_slug is not null;

create table if not exists public.marketplace_seller_categories (
  shop_id uuid not null references public.shops(id) on delete cascade,
  category_slug text not null references public.marketplace_category_catalog(slug) on delete restrict,
  primary key (shop_id, category_slug)
);

create table if not exists public.marketplace_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index if not exists marketplace_favorites_user_idx on public.marketplace_favorites (user_id);

create table if not exists public.marketplace_promotions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  description text,
  percent_off numeric(5,2) not null default 0 check (percent_off >= 0 and percent_off <= 100),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);

create table if not exists public.marketplace_shipping_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_shipping_profiles_shop_idx
  on public.marketplace_shipping_profiles (shop_id);

create table if not exists public.marketplace_pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  min_quantity numeric(12,2) not null default 1,
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_pricing_tiers_shop_idx
  on public.marketplace_pricing_tiers (shop_id);

alter table public.marketplace_listings
  add column if not exists description text;

alter table public.marketplace_listings
  add column if not exists category_slug text;

alter table public.marketplace_listings
  add column if not exists sku text;

alter table public.marketplace_listings
  add column if not exists low_stock_threshold numeric(12,2) default 5;

alter table public.marketplace_listings
  add column if not exists archived_at timestamptz;

alter table public.marketplace_listings
  add column if not exists allows_shipping boolean default true;

alter table public.marketplace_listings
  add column if not exists allows_local_pickup boolean default false;

create index if not exists marketplace_listings_category_slug_idx
  on public.marketplace_listings (category_slug);

create index if not exists marketplace_listings_active_idx
  on public.marketplace_listings (active, archived_at);

alter table public.marketplace_seller_profiles enable row level security;
alter table public.marketplace_seller_categories enable row level security;
alter table public.marketplace_favorites enable row level security;
alter table public.marketplace_promotions enable row level security;
alter table public.marketplace_shipping_profiles enable row level security;
alter table public.marketplace_pricing_tiers enable row level security;
alter table public.marketplace_category_catalog enable row level security;

drop policy if exists "marketplace category catalog read" on public.marketplace_category_catalog;
create policy "marketplace category catalog read" on public.marketplace_category_catalog
for select to authenticated using (active = true);

drop policy if exists "marketplace seller profile shop access" on public.marketplace_seller_profiles;
create policy "marketplace seller profile shop access" on public.marketplace_seller_profiles
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace seller profile public read" on public.marketplace_seller_profiles;
create policy "marketplace seller profile public read" on public.marketplace_seller_profiles
for select to authenticated using (true);

drop policy if exists "marketplace seller categories shop access" on public.marketplace_seller_categories;
create policy "marketplace seller categories shop access" on public.marketplace_seller_categories
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace seller categories read" on public.marketplace_seller_categories;
create policy "marketplace seller categories read" on public.marketplace_seller_categories
for select to authenticated using (true);

drop policy if exists "marketplace favorites owner access" on public.marketplace_favorites;
create policy "marketplace favorites owner access" on public.marketplace_favorites
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "marketplace promotions shop access" on public.marketplace_promotions;
create policy "marketplace promotions shop access" on public.marketplace_promotions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace shipping profiles shop access" on public.marketplace_shipping_profiles;
create policy "marketplace shipping profiles shop access" on public.marketplace_shipping_profiles
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace pricing tiers shop access" on public.marketplace_pricing_tiers;
create policy "marketplace pricing tiers shop access" on public.marketplace_pricing_tiers
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace active listings browse" on public.marketplace_listings;
create policy "marketplace active listings browse" on public.marketplace_listings
for select to authenticated
using (active = true and archived_at is null);

notify pgrst, 'reload schema';
