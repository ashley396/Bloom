-- Bloom v9.0 integrated production-candidate migration
alter table public.shops
  add column if not exists tagline text,
  add column if not exists slug text,
  add column if not exists logo_url text,
  add column if not exists primary_color text default '#a72f67',
  add column if not exists accent_color text default '#6f8f72',
  add column if not exists website_font text default 'Elegant',
  add column if not exists website_style text default 'Garden',
  add column if not exists hero_title text,
  add column if not exists hero_text text,
  add column if not exists hero_image_url text,
  add column if not exists about_text text,
  add column if not exists social_facebook text,
  add column if not exists social_instagram text,
  add column if not exists custom_domain text,
  add column if not exists website_published boolean not null default false,
  add column if not exists homepage_sections jsonb default '[]'::jsonb,
  add column if not exists delivery_radius numeric(10,2) default 25,
  add column if not exists tax_rate numeric(7,3) default 6,
  add column if not exists timezone text default 'America/New_York';

alter table public.customers
  add column if not exists birthday date,
  add column if not exists anniversary date,
  add column if not exists favorite_flowers text,
  add column if not exists favorite_colors text,
  add column if not exists tags text,
  add column if not exists vip boolean not null default false,
  add column if not exists is_business boolean not null default false;

alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists tax_rate numeric(7,3) default 0,
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists balance_due numeric(12,2) not null default 0,
  add column if not exists payment_status text not null default 'UNPAID',
  add column if not exists payment_method text,
  add column if not exists customer_type text default 'PERSONAL',
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists delivery_window text,
  add column if not exists delivery_instructions text,
  add column if not exists delivery_miles numeric(10,1) not null default 0,
  add column if not exists drive_minutes numeric(10,1) not null default 0,
  add column if not exists order_source text,
  add column if not exists card_message text,
  add column if not exists arrangement_description text;

update public.orders set balance_due=greatest(total-coalesce(amount_paid,0),0) where balance_due=0 and total>0;
