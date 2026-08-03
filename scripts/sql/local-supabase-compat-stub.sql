-- LOCAL REHEARSAL ONLY — not a hosted Supabase / staging migration.
-- Provides minimal auth/storage/role stubs so repository SQL can apply on bare PostgreSQL.
-- Hosted Supabase projects already provide these objects; do NOT run this against hosted staging.

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

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Ignore notify pgrst when PostgREST is not listening (local Postgres).
do $$ begin
  create or replace function public._ignore_notify_pgrst()
  returns event_trigger
  language plpgsql
  as $fn$
  begin
    null;
  end;
  $fn$;
exception when others then
  null;
end $$;
