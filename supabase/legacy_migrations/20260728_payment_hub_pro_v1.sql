-- Bloom Payment Hub Pro v1.1 (forward-only, idempotent). Review before apply.

alter table public.payment_hub_providers
  add column if not exists health_status text not null default 'unknown';

alter table public.payment_hub_providers
  add column if not exists webhook_status text not null default 'unknown';

alter table public.payment_hub_providers
  add column if not exists permissions_ok boolean not null default true;

alter table public.payment_hub_providers
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.gift_cards
  add column if not exists barcode text;

alter table public.house_accounts
  add column if not exists suspended_at timestamptz;

alter table public.house_accounts
  add column if not exists wholesale_credit_limit numeric(12,2) not null default 0;

alter table public.payment_hub_settings
  add column if not exists setup_wizard jsonb not null default '{}'::jsonb;

create table if not exists public.payment_hub_refunds (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider_id text not null,
  payment_id uuid references public.payments(id) on delete set null,
  provider_ref text,
  amount numeric(12,2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'voided')),
  partial boolean not null default false,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_hub_refunds_shop_idx on public.payment_hub_refunds (shop_id, created_at desc);

create table if not exists public.payment_hub_provider_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider_id text not null,
  event_type text not null,
  status text not null default 'info',
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_hub_provider_events_shop_idx on public.payment_hub_provider_events (shop_id, created_at desc);

create table if not exists public.house_account_statements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  house_account_id uuid not null references public.house_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  opening_balance numeric(12,2) not null default 0,
  closing_balance numeric(12,2) not null default 0,
  generated_at timestamptz not null default now()
);

alter table public.payment_hub_refunds enable row level security;
alter table public.payment_hub_provider_events enable row level security;
alter table public.house_account_statements enable row level security;

drop policy if exists "payment hub refunds shop access" on public.payment_hub_refunds;
create policy "payment hub refunds shop access" on public.payment_hub_refunds
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub provider events shop access" on public.payment_hub_provider_events;
create policy "payment hub provider events shop access" on public.payment_hub_provider_events
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "house account statements shop access" on public.house_account_statements;
create policy "house account statements shop access" on public.house_account_statements
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
