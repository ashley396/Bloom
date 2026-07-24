create extension if not exists pgcrypto;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Flower Shop',
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  default_shop_id uuid references public.shops(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','employee')),
  created_at timestamptz not null default now(),
  unique(shop_id, user_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
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
  status text not null default 'NEW' check (status in ('NEW','DESIGNING','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
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

alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.shop_members enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.inventory enable row level security;
alter table public.expenses enable row level security;

create or replace function public.is_shop_member(target_shop uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop and user_id = auth.uid()
  );
$$;

drop policy if exists "profiles own row" on public.profiles;
create policy "profiles own row" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "shops members access" on public.shops;
create policy "shops members access" on public.shops
for all using (public.is_shop_member(id) or owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "members shop access" on public.shop_members;
create policy "members shop access" on public.shop_members
for select using (public.is_shop_member(shop_id));

drop policy if exists "customers shop access" on public.customers;
create policy "customers shop access" on public.customers
for all using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "orders shop access" on public.orders;
create policy "orders shop access" on public.orders
for all using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "inventory shop access" on public.inventory;
create policy "inventory shop access" on public.inventory
for all using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

drop policy if exists "expenses shop access" on public.expenses;
create policy "expenses shop access" on public.expenses
for all using (public.is_shop_member(shop_id))
with check (public.is_shop_member(shop_id));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_shop_id uuid;
begin
  insert into public.shops (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'shop_name', 'My Flower Shop'))
  returning id into new_shop_id;

  insert into public.profiles (id, full_name, default_shop_id)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new_shop_id);

  insert into public.shop_members (shop_id, user_id, role)
  values (new_shop_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

notify pgrst, 'reload schema';
