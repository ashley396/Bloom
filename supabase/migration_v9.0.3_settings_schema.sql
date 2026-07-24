-- Bloom v9.0.3 comprehensive shop settings schema fix
-- Safe additive migration. Existing data is preserved.

alter table public.shops
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists tagline text,
  add column if not exists slug text,
  add column if not exists logo_url text,
  add column if not exists primary_color text,
  add column if not exists accent_color text,
  add column if not exists website_font text,
  add column if not exists website_style text,
  add column if not exists hero_title text,
  add column if not exists hero_text text,
  add column if not exists hero_image_url text,
  add column if not exists about_text text,
  add column if not exists social_facebook text,
  add column if not exists social_instagram text,
  add column if not exists custom_domain text,
  add column if not exists website_published boolean not null default false,
  add column if not exists homepage_sections jsonb not null default '[]'::jsonb,
  add column if not exists delivery_radius numeric(10,2) default 25,
  add column if not exists default_delivery_fee numeric(10,2) not null default 10,
  add column if not exists tax_rate numeric(7,3) default 6,
  add column if not exists timezone text default 'America/New_York';

update public.shops
set
  default_delivery_fee = coalesce(default_delivery_fee, 10),
  delivery_radius = coalesce(delivery_radius, 25),
  tax_rate = coalesce(tax_rate, 6),
  website_published = coalesce(website_published, false),
  homepage_sections = coalesce(homepage_sections, '[]'::jsonb),
  timezone = coalesce(timezone, 'America/New_York');

-- Ask Supabase/PostgREST to refresh its schema cache immediately.
notify pgrst, 'reload schema';
