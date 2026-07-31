-- Minimal schema for Floral Library P0-01 RLS integration tests (local Postgres only).
-- Not a production migration. Does not include Community objects.

create extension if not exists "pgcrypto";

create schema if not exists auth;

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

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  display_name text,
  active boolean not null default true
);

alter table public.platform_admins enable row level security;

-- Mirror production create from 20260728_bloom_rc1_instant_websites.sql (tables only).
create table if not exists public.bloom_floral_library_master (
  id text primary key,
  name text not null,
  data jsonb not null,
  image_license jsonb not null default '{}'::jsonb,
  review_status text not null default 'approved_starter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_library_import_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending_review',
  manifest jsonb not null default '[]'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Reproduce the insecure prior policy that existed before P0-01 (for apply realism).
drop policy if exists "floral library master read" on public.bloom_floral_library_master;
create policy "floral library master read" on public.bloom_floral_library_master
for select using (true);

-- Baseline grants that historically exposed these tables to browser roles.
grant select, insert, update, delete on table public.bloom_floral_library_master to anon, authenticated, service_role;
grant select, insert, update, delete on table public.bloom_library_import_batches to anon, authenticated, service_role;
