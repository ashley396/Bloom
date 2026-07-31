-- Florisyn Florist Community Beta v1
-- Cross-shop feed for authenticated florists. No customer/order/payment/employee data.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Do not apply to production until AUGUST10-PRODUCTION-CHECKLIST.md steps are followed.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and coalesce(active, true) = true
  );
$$;

-- Legacy-safe: do not reference shop_members.status (column may be absent until R1).
create or replace function public.is_shop_manager_of(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = target_shop
      and user_id = auth.uid()
      and lower(role) in ('owner', 'manager', 'admin')
  );
$$;

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

drop policy if exists "community profiles select authenticated" on public.florist_community_profiles;
create policy "community profiles select authenticated"
  on public.florist_community_profiles
  for select
  to authenticated
  using (true);

drop policy if exists "community profiles insert own" on public.florist_community_profiles;
create policy "community profiles insert own"
  on public.florist_community_profiles
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_shop_member(shop_id)
  );

drop policy if exists "community profiles update own" on public.florist_community_profiles;
create policy "community profiles update own"
  on public.florist_community_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_shop_member(shop_id)
  );

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
create policy "community posts select"
  on public.florist_community_posts
  for select
  to authenticated
  using (
    status = 'active'
    or author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community posts insert" on public.florist_community_posts;
create policy "community posts insert"
  on public.florist_community_posts
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_shop_member(shop_id)
    and status = 'active'
  );

drop policy if exists "community posts update" on public.florist_community_posts;
create policy "community posts update"
  on public.florist_community_posts
  for update
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  )
  with check (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community posts delete" on public.florist_community_posts;
create policy "community posts delete"
  on public.florist_community_posts
  for delete
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

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
create policy "community comments select"
  on public.florist_community_comments
  for select
  to authenticated
  using (
    status = 'active'
    or author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community comments insert" on public.florist_community_comments;
create policy "community comments insert"
  on public.florist_community_comments
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_shop_member(shop_id)
    and status = 'active'
  );

drop policy if exists "community comments update" on public.florist_community_comments;
create policy "community comments update"
  on public.florist_community_comments
  for update
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  )
  with check (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community comments delete" on public.florist_community_comments;
create policy "community comments delete"
  on public.florist_community_comments
  for delete
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

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
create policy "community likes select"
  on public.florist_community_likes
  for select
  to authenticated
  using (true);

drop policy if exists "community likes insert" on public.florist_community_likes;
create policy "community likes insert"
  on public.florist_community_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_shop_member(shop_id)
  );

drop policy if exists "community likes delete" on public.florist_community_likes;
create policy "community likes delete"
  on public.florist_community_likes
  for delete
  to authenticated
  using (user_id = auth.uid());

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
create policy "community reports insert"
  on public.florist_community_reports
  for insert
  to authenticated
  with check (
    reporter_user_id = auth.uid()
    and public.is_shop_member(reporter_shop_id)
  );

drop policy if exists "community reports select own or admin" on public.florist_community_reports;
create policy "community reports select own or admin"
  on public.florist_community_reports
  for select
  to authenticated
  using (
    reporter_user_id = auth.uid()
    or public.is_platform_admin_user()
  );

drop policy if exists "community reports update admin" on public.florist_community_reports;
create policy "community reports update admin"
  on public.florist_community_reports
  for update
  to authenticated
  using (public.is_platform_admin_user())
  with check (public.is_platform_admin_user());

-- ---------------------------------------------------------------------------
-- Storage bucket (arrangement images only)
-- Path: {shop_id}/{user_id}/{timestamp-uuid}.{ext}
-- Public read — images are intentionally shared in Community Beta.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'florist-community',
  'florist-community',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "community images select" on storage.objects;
create policy "community images select"
  on storage.objects
  for select
  to public
  using (bucket_id = 'florist-community');

drop policy if exists "community images insert member" on storage.objects;
create policy "community images insert member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'florist-community'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "community images delete own" on storage.objects;
create policy "community images delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'florist-community'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.is_platform_admin_user()
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.is_shop_manager_of((storage.foldername(name))[1]::uuid)
      )
    )
  );

drop policy if exists "community images service role" on storage.objects;
create policy "community images service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'florist-community')
  with check (bucket_id = 'florist-community');

notify pgrst, 'reload schema';
