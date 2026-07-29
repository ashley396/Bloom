-- Bloom Payment Hub v1 (forward-only, idempotent). Review before apply — do not run in production without review.

create table if not exists public.payment_hub_providers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider_id text not null check (provider_id in ('stripe', 'square', 'clover', 'paypal', 'authorize_net')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'pending', 'error')),
  mode text not null default 'test' check (mode in ('test', 'live', 'coming_soon', 'unconfigured')),
  is_default boolean not null default false,
  provider_ref text,
  token_ciphertext bytea,
  coming_soon boolean not null default false,
  last_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, provider_id)
);

create index if not exists payment_hub_providers_shop_idx on public.payment_hub_providers (shop_id);

create table if not exists public.payment_hub_method_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  methods jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_hub_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  default_provider_id text check (default_provider_id is null or default_provider_id in ('stripe', 'square', 'clover', 'paypal', 'authorize_net')),
  wholesale_terms jsonb not null default '{"default_term":"due_on_receipt","credit_enabled":true}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  initial_amount numeric(12,2) not null,
  balance numeric(12,2) not null,
  expires_at timestamptz,
  active boolean not null default true,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, code)
);

create index if not exists gift_cards_shop_code_idx on public.gift_cards (shop_id, lower(code));

create table if not exists public.gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  amount numeric(12,2) not null,
  kind text not null check (kind in ('issue', 'redeem', 'adjust', 'expire')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.house_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  balance numeric(12,2) not null default 0,
  credit_limit numeric(12,2) not null default 0,
  payment_term text not null default 'net_30' check (payment_term in ('due_on_receipt', 'net_30', 'net_60', 'purchase_order')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists house_accounts_shop_idx on public.house_accounts (shop_id);

create table if not exists public.house_account_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  house_account_id uuid not null references public.house_accounts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  amount numeric(12,2) not null,
  kind text not null check (kind in ('charge', 'payment', 'adjustment', 'statement')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.payment_hub_providers enable row level security;
alter table public.payment_hub_method_settings enable row level security;
alter table public.payment_hub_settings enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_transactions enable row level security;
alter table public.house_accounts enable row level security;
alter table public.house_account_transactions enable row level security;

drop policy if exists "payment hub providers shop access" on public.payment_hub_providers;
create policy "payment hub providers shop access" on public.payment_hub_providers
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub methods shop access" on public.payment_hub_method_settings;
create policy "payment hub methods shop access" on public.payment_hub_method_settings
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub settings shop access" on public.payment_hub_settings;
create policy "payment hub settings shop access" on public.payment_hub_settings
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "gift cards shop access" on public.gift_cards;
create policy "gift cards shop access" on public.gift_cards
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "gift card tx shop access" on public.gift_card_transactions;
create policy "gift card tx shop access" on public.gift_card_transactions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "house accounts shop access" on public.house_accounts;
create policy "house accounts shop access" on public.house_accounts
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "house account tx shop access" on public.house_account_transactions;
create policy "house account tx shop access" on public.house_account_transactions
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
