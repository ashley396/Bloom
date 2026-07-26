-- Bloom v20.5 Admin Control Center
-- Run once in Supabase SQL Editor.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin' check (role in ('super_admin','support','designer','billing')),
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_admin_config (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  account_status text not null default 'active' check (account_status in ('active','maintenance','suspended')),
  support_message text,
  announcement text,
  theme jsonb not null default '{}'::jsonb,
  navigation jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
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
alter table public.shop_admin_config enable row level security;
alter table public.platform_admin_audit enable row level security;

-- No browser-facing policies are created. Access is only through secured Netlify functions
-- using the Supabase service role after verifying the signed-in user is a platform admin.

-- After creating your separate Bloom Admin auth user, replace the UUID below and run it once:
-- insert into public.platform_admins (user_id, role, display_name)
-- values ('YOUR-ADMIN-AUTH-USER-UUID', 'super_admin', 'Ashley Goodman')
-- on conflict (user_id) do update set active=true, role='super_admin';
