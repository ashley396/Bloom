-- Bloom Commercial v4.1 migration
-- Run once in Supabase SQL Editor before deploying v4.1.
alter table public.customers add column if not exists deleted_at timestamptz;
alter table public.inventory add column if not exists deleted_at timestamptz;
create index if not exists customers_shop_active_idx on public.customers(shop_id, name) where deleted_at is null;
create index if not exists inventory_shop_active_idx on public.inventory(shop_id, name) where deleted_at is null;
notify pgrst, 'reload schema';
