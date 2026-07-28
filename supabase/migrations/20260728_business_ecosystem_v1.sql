-- Bloom Business Ecosystem v1 (forward-only, idempotent). Review before apply.

create table if not exists public.bloom_customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  subscription_type text not null default 'fresh_flowers',
  schedule text not null default 'weekly' check (schedule in ('weekly','biweekly','monthly','quarterly','custom')),
  custom_interval_days int,
  amount numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  next_delivery_date date,
  gift_recipient text,
  payment_processor text default 'payment_hub',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bloom_customer_subscriptions_shop_idx on public.bloom_customer_subscriptions (shop_id, status);

create table if not exists public.bloom_loyalty_accounts (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  points_balance int not null default 0,
  lifetime_points int not null default 0,
  tier text not null default 'bloom',
  birthday_reward_year int,
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  points int not null,
  kind text not null check (kind in ('earn','redeem','adjust','referral','birthday','coupon')),
  reference_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_membership_plans (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  plan_key text not null,
  name text not null,
  benefits jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, plan_key)
);

create table if not exists public.bloom_membership_enrollments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  plan_id uuid not null references public.bloom_membership_plans(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'active',
  enrolled_at timestamptz not null default now()
);

create table if not exists public.bloom_vendor_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null,
  payment_terms text default 'net_30',
  contacts jsonb not null default '{}'::jsonb,
  performance_score numeric(5,2) default 0,
  price_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  vendor_id uuid references public.bloom_vendor_profiles(id) on delete set null,
  status text not null default 'draft',
  total numeric(12,2) not null default 0,
  notes text,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.bloom_purchase_orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  sku text,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  received_qty numeric(12,2) not null default 0
);

create table if not exists public.bloom_delivery_details (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  delivery_id uuid references public.deliveries(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  driver text,
  route_name text,
  gps_note text,
  status text not null default 'scheduled',
  proof_photo_url text,
  signature_data_url text,
  mileage numeric(10,2),
  fuel_cost numeric(10,2),
  updated_at timestamptz not null default now()
);

alter table public.bloom_customer_subscriptions enable row level security;
alter table public.bloom_loyalty_accounts enable row level security;
alter table public.bloom_loyalty_transactions enable row level security;
alter table public.bloom_membership_plans enable row level security;
alter table public.bloom_membership_enrollments enable row level security;
alter table public.bloom_vendor_profiles enable row level security;
alter table public.bloom_purchase_orders enable row level security;
alter table public.bloom_purchase_order_lines enable row level security;
alter table public.bloom_delivery_details enable row level security;

drop policy if exists "bloom customer subs shop" on public.bloom_customer_subscriptions;
create policy "bloom customer subs shop" on public.bloom_customer_subscriptions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom loyalty shop" on public.bloom_loyalty_accounts;
create policy "bloom loyalty shop" on public.bloom_loyalty_accounts
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom loyalty tx shop" on public.bloom_loyalty_transactions;
create policy "bloom loyalty tx shop" on public.bloom_loyalty_transactions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom membership plans shop" on public.bloom_membership_plans;
create policy "bloom membership plans shop" on public.bloom_membership_plans
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom membership enroll shop" on public.bloom_membership_enrollments;
create policy "bloom membership enroll shop" on public.bloom_membership_enrollments
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom vendors shop" on public.bloom_vendor_profiles;
create policy "bloom vendors shop" on public.bloom_vendor_profiles
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom po shop" on public.bloom_purchase_orders;
create policy "bloom po shop" on public.bloom_purchase_orders
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom po lines shop" on public.bloom_purchase_order_lines;
create policy "bloom po lines shop" on public.bloom_purchase_order_lines
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "bloom delivery details shop" on public.bloom_delivery_details;
create policy "bloom delivery details shop" on public.bloom_delivery_details
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
