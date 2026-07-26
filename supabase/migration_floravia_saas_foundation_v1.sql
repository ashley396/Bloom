-- Floravia SaaS Foundation v1
-- Run once in Supabase SQL Editor.
-- Creates secure shop onboarding, subscriptions, roles, AI profiles, and tenant isolation helpers.

create extension if not exists pgcrypto;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  onboarding_complete boolean not null default false,
  logo_url text,
  phone text,
  email text,
  website text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  timezone text not null default 'America/New_York',
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  default_delivery_fee numeric(12,2) not null default 0 check (default_delivery_fee >= 0),
  receipt_header text,
  invoice_prefix text not null default 'INV',
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner','manager','designer','cashier','driver','marketer','accountant','staff')),
  status text not null default 'active'
    check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  default_shop_id uuid references public.shops(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_subscriptions (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  plan_code text not null default 'trial'
    check (plan_code in ('trial','starter','professional','premium')),
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','paused','canceled','incomplete')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_shop_profiles (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  lily_enabled boolean not null default true,
  rose_enabled boolean not null default true,
  lily_voice text,
  rose_voice text,
  shop_tone text not null default 'warm, capable, florist-friendly',
  pricing_notes text,
  delivery_notes text,
  marketing_notes text,
  memory jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_hours (
  shop_id uuid not null references public.shops(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  primary key (shop_id, weekday)
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.user_has_shop_access(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.user_is_shop_owner(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop_id
      and user_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shops_touch_updated_at on public.shops;
create trigger shops_touch_updated_at before update on public.shops
for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on public.shop_subscriptions;
create trigger subscriptions_touch_updated_at before update on public.shop_subscriptions
for each row execute function public.touch_updated_at();

drop trigger if exists ai_profiles_touch_updated_at on public.ai_shop_profiles;
create trigger ai_profiles_touch_updated_at before update on public.ai_shop_profiles
for each row execute function public.touch_updated_at();

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.profiles enable row level security;
alter table public.shop_subscriptions enable row level security;
alter table public.ai_shop_profiles enable row level security;
alter table public.shop_hours enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "members read shops" on public.shops;
create policy "members read shops" on public.shops
for select using (public.user_has_shop_access(id));

drop policy if exists "owners update shops" on public.shops;
create policy "owners update shops" on public.shops
for update using (public.user_is_shop_owner(id))
with check (public.user_is_shop_owner(id));

drop policy if exists "members read memberships" on public.shop_members;
create policy "members read memberships" on public.shop_members
for select using (public.user_has_shop_access(shop_id));

drop policy if exists "owners manage memberships" on public.shop_members;
create policy "owners manage memberships" on public.shop_members
for all using (public.user_is_shop_owner(shop_id))
with check (public.user_is_shop_owner(shop_id));

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
for select using (id = auth.uid());

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members read subscription" on public.shop_subscriptions;
create policy "members read subscription" on public.shop_subscriptions
for select using (public.user_has_shop_access(shop_id));

drop policy if exists "members read ai profile" on public.ai_shop_profiles;
create policy "members read ai profile" on public.ai_shop_profiles
for select using (public.user_has_shop_access(shop_id));

drop policy if exists "owners update ai profile" on public.ai_shop_profiles;
create policy "owners update ai profile" on public.ai_shop_profiles
for update using (public.user_is_shop_owner(shop_id))
with check (public.user_is_shop_owner(shop_id));

drop policy if exists "members read shop hours" on public.shop_hours;
create policy "members read shop hours" on public.shop_hours
for select using (public.user_has_shop_access(shop_id));

drop policy if exists "owners manage shop hours" on public.shop_hours;
create policy "owners manage shop hours" on public.shop_hours
for all using (public.user_is_shop_owner(shop_id))
with check (public.user_is_shop_owner(shop_id));

drop policy if exists "members read audit events" on public.audit_events;
create policy "members read audit events" on public.audit_events
for select using (public.user_has_shop_access(shop_id));

-- Add shop_id to existing business tables only when each table exists.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','orders','inventory','products','invoices','payments',
    'recipes','expenses','staff','vendors','deliveries'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists shop_id uuid references public.shops(id) on delete cascade', t);
      execute format('create index if not exists %I on public.%I(shop_id)', t || '_shop_id_idx', t);
    end if;
  end loop;
end $$;
