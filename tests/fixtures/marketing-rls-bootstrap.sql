-- Minimal schema for Marketing Studio RLS integration tests (local
-- Postgres only). Not a production migration.
--
-- Sets up exactly the shared foundation Marketing's own real migrations
-- (applied separately, verbatim, by scripts/apply-marketing-rls-local.mjs)
-- depend on: roles, auth.uid(), shops/shop_members with the CURRENT
-- (post-R1) shape — a status column and an is_shop_member() that checks
-- it, matching supabase/migrations/20260804000000_greenfield_baseline.sql
-- exactly — plus two minimal stub tables (marketing_campaigns,
-- website_media) so the real Marketing migrations' own foreign keys are
-- satisfiable without pulling in every unrelated system those real
-- migrations also happen to touch (marketing_campaigns_v1.sql itself
-- ALTERs email_campaigns/holiday_peaks, which this deliberately narrow
-- Marketing-only test has no reason to bootstrap).

create extension if not exists "pgcrypto";

create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema auth to service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Current (post-R1) shape: status column present — matches
-- supabase/migrations/20260804000000_greenfield_baseline.sql exactly, so
-- is_shop_member()'s real "status = 'active'" check below is actually
-- meaningful, not tested against a schema shape production left behind.
create table if not exists public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The real, current production is_shop_member() — verbatim from
-- 20260804000000_greenfield_baseline.sql — never a looser
-- re-derivation for the sake of the test.
create or replace function public.is_shop_member(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members
    where shop_id = target_shop
      and user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function public.is_shop_member(uuid) from public;
revoke all on function public.is_shop_member(uuid) from anon;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.is_shop_member(uuid) to service_role;

grant select, insert, update, delete on table public.shops to authenticated, service_role;
grant select, insert, update, delete on table public.shop_members to authenticated, service_role;
grant select on table public.shops to anon;

-- Minimal stubs — only the columns Marketing's real FKs actually
-- reference. Real RLS ("shop access") is applied so a stray direct query
-- against these from an authenticated role behaves the same shop-scoped
-- way the real marketing_campaigns/website_media tables do, without
-- pulling in either table's own full real migration (both have
-- dependencies well outside Marketing's own scope).
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade
);
alter table public.marketing_campaigns enable row level security;
create policy "marketing campaigns shop access" on public.marketing_campaigns
  for all to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));
grant select, insert, update, delete on table public.marketing_campaigns to authenticated, service_role;

create table if not exists public.website_media (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade
);
alter table public.website_media enable row level security;
create policy "website media shop access" on public.website_media
  for all to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));
grant select, insert, update, delete on table public.website_media to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
