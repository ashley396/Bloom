-- Bloom Subscription Center v1 (forward-only, idempotent). Review before apply.

create table if not exists public.shop_subscription_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  event_type text not null check (
    event_type in ('upgrade', 'downgrade', 'pause', 'resume', 'cancel', 'reactivate', 'export', 'portal')
  ),
  reason_code text,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shop_subscription_events_shop_idx
  on public.shop_subscription_events (shop_id, created_at desc);

create table if not exists public.shop_subscription_exit_surveys (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  reason_code text,
  feedback text,
  skipped boolean not null default false,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shop_subscription_exit_surveys_shop_idx
  on public.shop_subscription_exit_surveys (shop_id, created_at desc);

alter table public.shop_subscriptions
  add column if not exists paused_at timestamptz;

alter table public.shop_subscriptions
  add column if not exists reactivated_at timestamptz;

alter table public.shop_subscription_events enable row level security;
alter table public.shop_subscription_exit_surveys enable row level security;

drop policy if exists "shop subscription events member read" on public.shop_subscription_events;
create policy "shop subscription events member read" on public.shop_subscription_events
for select using (public.is_shop_member(shop_id));

drop policy if exists "shop subscription events service write" on public.shop_subscription_events;
create policy "shop subscription events service write" on public.shop_subscription_events
for insert with check (public.is_shop_member(shop_id));

drop policy if exists "shop exit survey member" on public.shop_subscription_exit_surveys;
create policy "shop exit survey member" on public.shop_subscription_exit_surveys
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
