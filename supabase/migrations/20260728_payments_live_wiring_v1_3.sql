-- Bloom Payments Live Wiring v1.3 (review only, idempotent).

create table if not exists public.payment_hub_webhook_idempotency (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null default 'stripe',
  provider_event_id text not null,
  shop_id uuid references public.shops(id) on delete set null,
  event_type text not null,
  resource_id text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider_id, provider_event_id)
);

create index if not exists payment_hub_webhook_idem_shop_idx on public.payment_hub_webhook_idempotency (shop_id, created_at desc);

alter table public.payment_hub_recurring_runs
  add column if not exists run_key text;

create unique index if not exists payment_hub_recurring_runs_run_key_uq
  on public.payment_hub_recurring_runs (shop_id, run_key)
  where run_key is not null;

alter table public.payment_hub_saved_methods
  add column if not exists stripe_customer_id text;

alter table public.customers
  add column if not exists sms_consent boolean not null default false;

alter table public.customers
  add column if not exists email_marketing_consent boolean not null default true;

create table if not exists public.customer_portal_access (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (token_hash)
);

create index if not exists customer_portal_access_customer_idx on public.customer_portal_access (shop_id, customer_id);

alter table public.payment_hub_webhook_idempotency enable row level security;
alter table public.customer_portal_access enable row level security;

drop policy if exists "payment hub webhook idem service" on public.payment_hub_webhook_idempotency;
create policy "payment hub webhook idem service" on public.payment_hub_webhook_idempotency
for all using (public.is_shop_member(shop_id) or shop_id is null)
with check (public.is_shop_member(shop_id) or shop_id is null);

drop policy if exists "customer portal access shop" on public.customer_portal_access;
create policy "customer portal access shop" on public.customer_portal_access
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
