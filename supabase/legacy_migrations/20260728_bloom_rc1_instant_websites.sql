-- Bloom RC1 Instant Websites & Floral Library (review only, idempotent).

create table if not exists public.bloom_website_projects (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  launch_mode text not null default 'classic_florist',
  theme_id text not null default 'classic_florist',
  status text not null default 'draft' check (status in ('draft','preview','published')),
  temporary_url text,
  custom_domain text,
  domain_status jsonb not null default '{}'::jsonb,
  theme_settings jsonb not null default '{}'::jsonb,
  seo_settings jsonb not null default '{}'::jsonb,
  seasonal_schedule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id)
);

create table if not exists public.bloom_website_pages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  project_id uuid not null references public.bloom_website_projects(id) on delete cascade,
  slug text not null,
  title text not null,
  visible boolean not null default true,
  nav_order int not null default 0,
  template text not null default 'custom',
  content jsonb not null default '{}'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists public.bloom_website_page_versions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  page_id uuid not null references public.bloom_website_pages(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_floral_library_master (
  id text primary key,
  name text not null,
  data jsonb not null,
  image_license jsonb not null default '{}'::jsonb,
  review_status text not null default 'approved_starter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_shop_catalog_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  master_library_id text references public.bloom_floral_library_master(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  publish_status text not null default 'draft',
  sync jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_library_import_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending_review',
  manifest jsonb not null default '[]'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bloom_website_projects enable row level security;
alter table public.bloom_website_pages enable row level security;
alter table public.bloom_website_page_versions enable row level security;
alter table public.bloom_shop_catalog_products enable row level security;

drop policy if exists "website projects shop" on public.bloom_website_projects;
create policy "website projects shop" on public.bloom_website_projects
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "website pages shop" on public.bloom_website_pages;
create policy "website pages shop" on public.bloom_website_pages
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "website page versions shop" on public.bloom_website_page_versions;
create policy "website page versions shop" on public.bloom_website_page_versions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "shop catalog products shop" on public.bloom_shop_catalog_products;
create policy "shop catalog products shop" on public.bloom_shop_catalog_products
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "floral library master read" on public.bloom_floral_library_master;
create policy "floral library master read" on public.bloom_floral_library_master
for select using (true);
