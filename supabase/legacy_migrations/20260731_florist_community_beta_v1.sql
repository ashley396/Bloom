-- Florisyn Florist Community Beta v1 (LOCKED schema bootstrap)
-- Creates Community tables + private storage under RLS with NO authenticated/public access.
-- Final authorization is installed only by 20260731_florist_community_beta_v1_r1_security.sql.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Do not apply to production until AUGUST10-PRODUCTION-CHECKLIST.md steps are followed.
-- If the security migration fails after v1, Community remains locked — not publicly accessible.

-- ---------------------------------------------------------------------------
-- Helpers (LOCKED in v1 — not executable by anon/authenticated)
-- Final authorization is established only by the R1/R2 security migration.
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.active = true
  );
$$;

-- Legacy-safe: do not reference shop_members.status (column may be absent until R1).
create or replace function public.is_shop_manager_of(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = target_shop
      and sm.user_id = auth.uid()
      and lower(sm.role) in ('owner', 'manager', 'admin')
  );
$$;

revoke all on function public.is_platform_admin_user() from public;
revoke all on function public.is_platform_admin_user() from anon;
revoke all on function public.is_platform_admin_user() from authenticated;
grant execute on function public.is_platform_admin_user() to service_role;

revoke all on function public.is_shop_manager_of(uuid) from public;
revoke all on function public.is_shop_manager_of(uuid) from anon;
revoke all on function public.is_shop_manager_of(uuid) from authenticated;
grant execute on function public.is_shop_manager_of(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Profiles (public florist identity only)
-- ---------------------------------------------------------------------------

create table if not exists public.florist_community_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  display_name text not null,
  shop_display_name text not null,
  city text,
  region text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint florist_community_profiles_display_name_len check (char_length(display_name) between 1 and 80),
  constraint florist_community_profiles_shop_name_len check (char_length(shop_display_name) between 1 and 120),
  constraint florist_community_profiles_bio_len check (bio is null or char_length(bio) <= 500)
);

create index if not exists florist_community_profiles_shop_idx
  on public.florist_community_profiles (shop_id);

alter table public.florist_community_profiles enable row level security;


-- v1 LOCKED STATE: enable RLS and DROP every Community policy.
-- Authenticated/anon have no Community access until R1/R2 installs final policies.
-- Service role retains break-glass access (BYPASSRLS / service policies).

drop policy if exists "community profiles select authenticated" on public.florist_community_profiles;
drop policy if exists "community profiles select active florist" on public.florist_community_profiles;
drop policy if exists "community profiles insert own" on public.florist_community_profiles;
drop policy if exists "community profiles update own" on public.florist_community_profiles;

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table if not exists public.florist_community_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  category text not null,
  caption text not null,
  body text,
  image_path text,
  status text not null default 'active',
  like_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint florist_community_posts_category_check
    check (category in ('Design Help', 'Business Advice', 'Questions', 'Celebrations')),
  constraint florist_community_posts_status_check
    check (status in ('active', 'hidden', 'removed')),
  constraint florist_community_posts_caption_len check (char_length(caption) between 1 and 280),
  constraint florist_community_posts_body_len check (body is null or char_length(body) <= 4000)
);

create index if not exists florist_community_posts_feed_idx
  on public.florist_community_posts (status, created_at desc);
create index if not exists florist_community_posts_author_idx
  on public.florist_community_posts (author_user_id);
create index if not exists florist_community_posts_shop_idx
  on public.florist_community_posts (shop_id);

alter table public.florist_community_posts enable row level security;

drop policy if exists "community posts select" on public.florist_community_posts;
drop policy if exists "community posts insert" on public.florist_community_posts;
drop policy if exists "community posts update" on public.florist_community_posts;
drop policy if exists "community posts update author content" on public.florist_community_posts;
drop policy if exists "community posts update moderator" on public.florist_community_posts;
drop policy if exists "community posts delete" on public.florist_community_posts;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create table if not exists public.florist_community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.florist_community_posts (id) on delete cascade,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  body text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint florist_community_comments_status_check
    check (status in ('active', 'hidden', 'removed')),
  constraint florist_community_comments_body_len check (char_length(body) between 1 and 1000)
);

create index if not exists florist_community_comments_post_idx
  on public.florist_community_comments (post_id, created_at);

alter table public.florist_community_comments enable row level security;

drop policy if exists "community comments select" on public.florist_community_comments;
drop policy if exists "community comments insert" on public.florist_community_comments;
drop policy if exists "community comments update" on public.florist_community_comments;
drop policy if exists "community comments update author content" on public.florist_community_comments;
drop policy if exists "community comments delete" on public.florist_community_comments;

-- ---------------------------------------------------------------------------
-- Likes / encouragement
-- ---------------------------------------------------------------------------

create table if not exists public.florist_community_likes (
  post_id uuid not null references public.florist_community_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists florist_community_likes_user_idx
  on public.florist_community_likes (user_id);

alter table public.florist_community_likes enable row level security;

drop policy if exists "community likes select" on public.florist_community_likes;
drop policy if exists "community likes insert" on public.florist_community_likes;
drop policy if exists "community likes delete" on public.florist_community_likes;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create table if not exists public.florist_community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.florist_community_posts (id) on delete cascade,
  reporter_user_id uuid not null references auth.users (id) on delete cascade,
  reporter_shop_id uuid not null references public.shops (id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint florist_community_reports_reason_len check (char_length(reason) between 3 and 500),
  constraint florist_community_reports_status_check
    check (status in ('open', 'reviewed', 'dismissed')),
  constraint florist_community_reports_unique_open unique (post_id, reporter_user_id)
);

alter table public.florist_community_reports enable row level security;

drop policy if exists "community reports insert" on public.florist_community_reports;
drop policy if exists "community reports select own or admin" on public.florist_community_reports;
drop policy if exists "community reports update admin" on public.florist_community_reports;

-- ---------------------------------------------------------------------------
-- Storage bucket — PRIVATE in v1 (no public read policy)
-- Path: {shop_id}/{user_id}/{timestamp-uuid}.{ext}
-- Authenticated image access is granted only by R1/R2.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'florist-community',
  'florist-community',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "community images select" on storage.objects;
drop policy if exists "community images select active florist" on storage.objects;
drop policy if exists "community images insert member" on storage.objects;
drop policy if exists "community images update" on storage.objects;
drop policy if exists "community images delete own" on storage.objects;
drop policy if exists "community images service role" on storage.objects;
create policy "community images service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'florist-community')
  with check (bucket_id = 'florist-community');

-- Explicitly revoke Community table access from anon (and do not grant authenticated policies yet).
revoke all on table public.florist_community_profiles from anon;
revoke all on table public.florist_community_posts from anon;
revoke all on table public.florist_community_comments from anon;
revoke all on table public.florist_community_likes from anon;
revoke all on table public.florist_community_reports from anon;

notify pgrst, 'reload schema';
