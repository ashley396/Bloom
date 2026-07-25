-- Bloom v8.5.2 delivery tracking
alter table public.orders
  add column if not exists delivery_miles numeric(10,1) not null default 0;
