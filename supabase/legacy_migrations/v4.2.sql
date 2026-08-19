-- Bloom Commercial v4.2 migration
-- Run once in Supabase SQL Editor before deploying v4.2.
alter table public.orders add column if not exists payment_status text not null default 'UNPAID';
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists payment_method text;
alter table public.expenses add column if not exists receipt_path text;
alter table public.shops add column if not exists logo_url text;
alter table public.shops add column if not exists primary_color text not null default '#b93870';
alter table public.shops add column if not exists accent_color text not null default '#6f8f72';
alter table public.shops add column if not exists website_font text not null default 'Modern';
alter table public.shops add column if not exists website_style text not null default 'Garden';
alter table public.shops add column if not exists hero_title text not null default 'Flowers made beautifully for every moment';
alter table public.shops add column if not exists hero_text text not null default 'Thoughtful floral designs, gifts, and local delivery.';
alter table public.shops add column if not exists website_published boolean not null default false;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('expense-receipts','expense-receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=5242880;

create index if not exists orders_shop_payment_idx on public.orders(shop_id,payment_status,paid_at);
notify pgrst, 'reload schema';
