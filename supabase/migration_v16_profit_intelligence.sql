-- Bloom v16 Profit Intelligence
alter table public.inventory add column if not exists arrival_date date default current_date;
alter table public.inventory add column if not exists vase_life_days integer not null default 7;
alter table public.inventory add column if not exists supplier text;
alter table public.inventory add column if not exists lot_code text;
update public.inventory set arrival_date=coalesce(arrival_date,created_at::date),vase_life_days=coalesce(vase_life_days,7);
create index if not exists inventory_shop_arrival_idx on public.inventory(shop_id,arrival_date) where deleted_at is null;
