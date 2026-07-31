-- Minimal schema for Florist Community RLS integration tests (local Postgres only).
-- Intentionally mirrors legacy/canonical production shape where practical:
--   - shop_members has NO status column until R1 adds it
--   - platform_admins has RLS with no browser-facing policies
--   - no broad anon grants that hide missing production privileges
-- Not a production migration.

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

-- Legacy / canonical shape: no status column (R1 migration adds it).
create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  display_name text,
  active boolean not null default true
);

create table if not exists public.platform_admin_audit (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit enable row level security;
-- No browser-facing policies on platform_admins / audit (matches production).

-- Baseline is_shop_member (membership without status)
create or replace function public.is_shop_member(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop and user_id = auth.uid()
  );
$$;

revoke all on function public.is_shop_member(uuid) from public;
revoke all on function public.is_shop_member(uuid) from anon;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.is_shop_member(uuid) to service_role;

-- Storage stubs
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

-- Minimum baseline table privileges only (not Community tables — those do not exist yet).
grant select, insert, update, delete on table public.shops to authenticated, service_role;
grant select, insert, update, delete on table public.shop_members to authenticated, service_role;
grant select on table public.shops to anon;
-- platform_admins: no grants to anon/authenticated (service_role only), matching locked-down production.
grant select, insert, update, delete on table public.platform_admins to service_role;
grant select, insert on table public.platform_admin_audit to service_role;
grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Ignore notify when no PostgREST listener
create or replace function public._ignore_notify_pgrst()
returns event_trigger language plpgsql as $$ begin null; end; $$;
