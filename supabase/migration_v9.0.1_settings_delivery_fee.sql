-- Bloom v9.0.1 settings and delivery defaults
-- Safe additive migration: does not remove any existing data.
alter table public.shops
  add column if not exists address text,
  add column if not exists default_delivery_fee numeric(10,2) not null default 10,
  add column if not exists delivery_radius numeric(10,2) default 25,
  add column if not exists tax_rate numeric(7,3) default 6;

update public.shops
set default_delivery_fee = 10
where default_delivery_fee is null;
