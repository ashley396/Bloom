-- Bloom v21 Platform Edition
-- Run ONCE in Supabase SQL Editor after the v20.5 and v20.6 migrations.
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
insert into public.platform_settings(key,value) values('rose_foundation','{"total":0}'::jsonb) on conflict(key) do nothing;
-- No browser policy is intentionally added. Secure Netlify functions use the service role.
