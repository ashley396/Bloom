-- Bloom v8.0 Florist Order Builder
alter table public.orders add column if not exists customer_phone text;
alter table public.orders add column if not exists order_source text default 'Phone';
alter table public.orders add column if not exists design_style text;
alter table public.orders add column if not exists color_palette text;
alter table public.orders add column if not exists preferred_flowers text;
alter table public.orders add column if not exists flower_restrictions text;
alter table public.orders add column if not exists arrangement_description text;
alter table public.orders add column if not exists addons text;
alter table public.orders add column if not exists addon_total numeric(12,2) not null default 0;
alter table public.orders add column if not exists labor_charge numeric(12,2) not null default 0;
alter table public.orders add column if not exists discount numeric(12,2) not null default 0;
alter table public.orders add column if not exists amount_paid numeric(12,2) not null default 0;
alter table public.orders add column if not exists location_type text;
alter table public.orders add column if not exists driver text;
alter table public.orders add column if not exists delivery_instructions text;
alter table public.orders add column if not exists priority text not null default 'NORMAL';

create index if not exists orders_shop_due_date_idx on public.orders(shop_id,delivery_date);
create index if not exists orders_shop_priority_idx on public.orders(shop_id,priority);
