-- Bloom Flagship v6.0
-- Run this ONE file in Supabase SQL Editor before deploying the code.

create extension if not exists pgcrypto;

alter table public.shops add column if not exists slug text;
alter table public.shops add column if not exists tagline text;
alter table public.shops add column if not exists logo_url text;
alter table public.shops add column if not exists primary_color text default '#b93870';
alter table public.shops add column if not exists accent_color text default '#6f8f72';
alter table public.shops add column if not exists website_font text default 'Elegant';
alter table public.shops add column if not exists website_style text default 'Garden';
alter table public.shops add column if not exists hero_title text default 'Flowers made beautifully for every moment';
alter table public.shops add column if not exists hero_text text default 'Thoughtful floral designs, gifts, and local delivery.';
alter table public.shops add column if not exists hero_image_url text;
alter table public.shops add column if not exists about_text text;
alter table public.shops add column if not exists social_facebook text;
alter table public.shops add column if not exists social_instagram text;
alter table public.shops add column if not exists custom_domain text;
alter table public.shops add column if not exists website_published boolean default false;
alter table public.shops add column if not exists homepage_sections jsonb default '["hero","featured","occasions","about","reviews","contact"]'::jsonb;
alter table public.shops add column if not exists delivery_radius numeric(8,2) default 15;
alter table public.shops add column if not exists tax_rate numeric(8,4) default 0;
alter table public.shops add column if not exists timezone text default 'America/New_York';

alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists anniversary date;
alter table public.customers add column if not exists favorite_flowers text;
alter table public.customers add column if not exists favorite_colors text;
alter table public.customers add column if not exists tags text[] default '{}';
alter table public.customers add column if not exists vip boolean default false;

alter table public.orders add column if not exists payment_status text default 'UNPAID';
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists recipient_name text;
alter table public.orders add column if not exists recipient_phone text;
alter table public.orders add column if not exists card_message text;
alter table public.orders add column if not exists designer text;
alter table public.orders add column if not exists driver text;
alter table public.orders add column if not exists delivery_window text;
alter table public.orders add column if not exists product_id uuid;
alter table public.orders add column if not exists cost_total numeric(12,2) default 0;

alter table public.expenses add column if not exists receipt_data_url text;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  sku text,
  name text not null,
  category text default 'Everyday',
  description text,
  image_url text,
  gallery jsonb default '[]'::jsonb,
  price numeric(12,2) not null default 0,
  compare_at_price numeric(12,2),
  labor_cost numeric(12,2) not null default 0,
  taxable boolean not null default true,
  active boolean not null default true,
  featured boolean not null default false,
  available_online boolean not null default false,
  seo_title text,
  seo_description text,
  tags text[] default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  inventory_id uuid references public.inventory(id) on delete set null,
  ingredient_name text not null,
  quantity numeric(12,2) not null default 1,
  unit text default 'stem',
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  title text not null,
  slug text not null,
  page_type text default 'CUSTOM',
  content jsonb default '{}'::jsonb,
  visible boolean default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  unique(shop_id, slug)
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text not null default 'employee',
  active boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  driver text,
  route_order integer default 0,
  status text default 'PENDING',
  delivered_at timestamptz,
  proof_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  website text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  supplier_name text not null,
  product_name text not null,
  category text default 'Fresh Flowers',
  unit text default 'bunch',
  price numeric(12,2) not null default 0,
  minimum_quantity numeric(12,2) default 1,
  available_quantity numeric(12,2),
  image_url text,
  delivery_notes text,
  active boolean default true,
  created_at timestamptz not null default now()
);

create index if not exists products_shop_idx on public.products(shop_id);
create index if not exists recipes_product_idx on public.product_recipes(product_id);
create index if not exists deliveries_shop_idx on public.deliveries(shop_id);
create index if not exists marketplace_shop_idx on public.marketplace_listings(shop_id);

alter table public.products enable row level security;
alter table public.product_recipes enable row level security;
alter table public.website_pages enable row level security;
alter table public.staff enable row level security;
alter table public.deliveries enable row level security;
alter table public.suppliers enable row level security;
alter table public.marketplace_listings enable row level security;

drop policy if exists "products shop access" on public.products;
create policy "products shop access" on public.products for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "recipes shop access" on public.product_recipes;
create policy "recipes shop access" on public.product_recipes for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "website pages shop access" on public.website_pages;
create policy "website pages shop access" on public.website_pages for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "staff shop access" on public.staff;
create policy "staff shop access" on public.staff for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "deliveries shop access" on public.deliveries;
create policy "deliveries shop access" on public.deliveries for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "suppliers shop access" on public.suppliers;
create policy "suppliers shop access" on public.suppliers for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "marketplace shop access" on public.marketplace_listings;
create policy "marketplace shop access" on public.marketplace_listings for all
using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

notify pgrst, 'reload schema';
