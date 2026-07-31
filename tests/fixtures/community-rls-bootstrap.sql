-- Minimal schema for Florist Community RLS integration tests (local Postgres only).
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

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  display_name text,
  active boolean not null default true
);

-- Baseline is_shop_member (membership without status) — community R1 uses is_active_* instead
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

grant select, insert, update, delete on all tables in schema public to authenticated, service_role, anon;
grant select, insert, update, delete on all tables in schema storage to authenticated, service_role, anon;
grant usage, select on all sequences in schema public to authenticated, service_role, anon;

-- Ignore notify when no PostgREST listener
create or replace function public._ignore_notify_pgrst()
returns event_trigger language plpgsql as $$ begin null; end; $$;
