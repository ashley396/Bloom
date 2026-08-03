-- Greenfield bridge (staging bootstrap) — required when starting from
-- supabase/migration_floravia_saas_foundation_v1.sql on an empty project.
-- Creates core POS tables that foundation does not create and that v4.1+/v6.0 assume.
-- Safe to re-run (IF NOT EXISTS). Not a substitute for historical production dumps.

create extension if not exists pgcrypto;

-- Compatibility alias used by some older policies / docs; foundation uses owner_user_id.
alter table public.shops add column if not exists owner_id uuid references auth.users(id) on delete restrict;
update public.shops set owner_id = owner_user_id where owner_id is null and owner_user_id is not null;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  occasion text,
  fulfillment text not null default 'PICKUP' check (fulfillment in ('PICKUP','DELIVERY')),
  delivery_address text,
  delivery_date date,
  status text not null default 'NEW',
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  category text default 'Flowers',
  quantity numeric(12,2) not null default 0,
  low_stock_level numeric(12,2) not null default 5,
  unit text default 'stems',
  cost numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null default 'Other',
  vendor text,
  amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- Membership helper expected by v6.0+ RLS policies (foundation provides user_has_shop_access instead).
create or replace function public.is_shop_member(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

revoke all on function public.is_shop_member(uuid) from public;
revoke all on function public.is_shop_member(uuid) from anon;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.is_shop_member(uuid) to service_role;

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.inventory enable row level security;
alter table public.expenses enable row level security;

grant select, insert, update, delete on table public.customers to authenticated, service_role;
grant select, insert, update, delete on table public.orders to authenticated, service_role;
grant select, insert, update, delete on table public.inventory to authenticated, service_role;
grant select, insert, update, delete on table public.expenses to authenticated, service_role;
grant select, insert, update, delete on table public.shops to authenticated, service_role;
grant select, insert, update, delete on table public.shop_members to authenticated, service_role;
