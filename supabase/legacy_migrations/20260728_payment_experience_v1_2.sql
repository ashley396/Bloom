-- Bloom Payments Experience v1.2 (forward-only, idempotent). Review before apply.

create table if not exists public.payment_hub_payment_links (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  token_hash text not null,
  amount_due numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  allow_partial boolean not null default true,
  status text not null default 'active' check (status in ('active','viewed','partially_paid','paid','expired','canceled')),
  expires_at timestamptz,
  viewed_at timestamptz,
  paid_at timestamptz,
  canceled_at timestamptz,
  delivery_channels jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token_hash)
);

create index if not exists payment_hub_payment_links_shop_idx on public.payment_hub_payment_links (shop_id, status, created_at desc);
create index if not exists payment_hub_payment_links_order_idx on public.payment_hub_payment_links (order_id);

create table if not exists public.payment_hub_saved_methods (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  provider_id text not null default 'stripe',
  provider_token_ref text not null,
  brand text,
  last4 text,
  exp_month smallint,
  exp_year smallint,
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_hub_saved_methods_customer_idx on public.payment_hub_saved_methods (shop_id, customer_id);

create table if not exists public.payment_hub_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  payment_link_id uuid references public.payment_hub_payment_links(id) on delete set null,
  attempt_number int not null default 1,
  status text not null default 'pending' check (status in ('pending','sent','failed','succeeded','exhausted')),
  channel text not null default 'email',
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_hub_recovery_shop_idx on public.payment_hub_recovery_attempts (shop_id, created_at desc);

create table if not exists public.payment_hub_recurring_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  subscription_id uuid references public.bloom_customer_subscriptions(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned','running','completed','failed')),
  plan jsonb not null default '{}'::jsonb,
  order_id uuid references public.orders(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists payment_hub_recurring_runs_shop_idx on public.payment_hub_recurring_runs (shop_id, created_at desc);

alter table public.payment_hub_refunds
  add column if not exists notes text;

alter table public.payment_hub_settings
  add column if not exists recovery_config jsonb not null default '{"max_retries":3,"retry_delay_hours":24,"email_reminders":true,"sms_reminders":false}'::jsonb;

alter table public.payment_hub_payment_links enable row level security;
alter table public.payment_hub_saved_methods enable row level security;
alter table public.payment_hub_recovery_attempts enable row level security;
alter table public.payment_hub_recurring_runs enable row level security;

drop policy if exists "payment hub links shop access" on public.payment_hub_payment_links;
create policy "payment hub links shop access" on public.payment_hub_payment_links
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub saved methods shop access" on public.payment_hub_saved_methods;
create policy "payment hub saved methods shop access" on public.payment_hub_saved_methods
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub recovery shop access" on public.payment_hub_recovery_attempts;
create policy "payment hub recovery shop access" on public.payment_hub_recovery_attempts
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "payment hub recurring runs shop access" on public.payment_hub_recurring_runs;
create policy "payment hub recurring runs shop access" on public.payment_hub_recurring_runs
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
