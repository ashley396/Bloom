-- Bloom Command Center v1 (forward-only, idempotent). Review before apply.

create table if not exists public.platform_feature_flags (
  flag_key text primary key,
  enabled boolean not null default true,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_feature_flags (flag_key, enabled, description)
values
  ('marketplace', true, 'Bloom marketplace buyer experience'),
  ('wholesale', true, 'Wholesale seller tools'),
  ('ai', true, 'Lily and Rose AI assistants'),
  ('voice', true, 'Voice assistant playback'),
  ('website_builder', true, 'Website Studio'),
  ('university', true, 'Bloom University content'),
  ('connect', true, 'Bloom Connect integrations'),
  ('beta_features', false, 'Experimental beta features')
on conflict (flag_key) do update set
  description = excluded.description;

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  kind text not null default 'announcement' check (
    kind in ('announcement', 'maintenance', 'holiday', 'feature_release', 'popup')
  ),
  audience text not null default 'everyone' check (
    audience in ('everyone', 'florists', 'wholesalers', 'selected')
  ),
  audience_user_ids uuid[] default '{}',
  popup boolean not null default false,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_announcements_active_idx
  on public.platform_announcements (active, starts_at, ends_at);

create table if not exists public.platform_support_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('ticket', 'feature_request', 'bug_report', 'feedback')),
  status text not null default 'open' check (
    status in ('open', 'assigned', 'resolved', 'closed')
  ),
  subject text not null,
  body text not null,
  shop_id uuid references public.shops(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_support_items_status_idx
  on public.platform_support_items (status, created_at desc);

create table if not exists public.platform_ai_usage_daily (
  usage_date date primary key,
  request_count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.marketplace_listings
  add column if not exists admin_review_status text default 'approved';

alter table public.marketplace_listings
  add column if not exists admin_review_notes text;

alter table public.marketplace_listings
  add column if not exists featured_at timestamptz;

alter table public.marketplace_listings
  add column if not exists admin_suspended_at timestamptz;

alter table public.platform_feature_flags enable row level security;
alter table public.platform_announcements enable row level security;
alter table public.platform_support_items enable row level security;
alter table public.platform_ai_usage_daily enable row level security;

-- No client policies: Command Center access is service-role only via verified platform admins.

notify pgrst, 'reload schema';
