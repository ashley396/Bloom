-- Florist Community profile avatars (private storage, signed URLs).
-- Safe to re-run.

alter table public.florist_community_profiles
  add column if not exists avatar_path text;

create index if not exists florist_community_profiles_avatar_path_idx
  on public.florist_community_profiles (avatar_path)
  where avatar_path is not null;

-- Active florists may read post images OR any community member avatar.
create or replace function public.florist_community_image_readable(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_path is not null
    and length(trim(p_path)) > 0
    and public.is_active_florist()
    and (
      exists (
        select 1
        from public.florist_community_posts p
        where p.image_path = p_path
          and (
            (p.status = 'active')
            or (
              p.status in ('hidden', 'removed')
              and (
                public.is_platform_admin_user()
                or (
                  p.author_user_id = auth.uid()
                )
                or public.is_shop_manager_of(p.shop_id)
              )
            )
          )
      )
      or exists (
        select 1
        from public.florist_community_profiles pr
        where pr.avatar_path = p_path
      )
    );
$$;

revoke all on function public.florist_community_image_readable(text) from public;
revoke all on function public.florist_community_image_readable(text) from anon;
grant execute on function public.florist_community_image_readable(text) to authenticated;
grant execute on function public.florist_community_image_readable(text) to service_role;

notify pgrst, 'reload schema';

-- Allow visual arrangement posts (Instagram-style category).
alter table public.florist_community_posts
  drop constraint if exists florist_community_posts_category_check;

alter table public.florist_community_posts
  add constraint florist_community_posts_category_check
  check (category in (
    'Design Help',
    'Business Advice',
    'Questions',
    'Celebrations',
    'Arrangement Share'
  ));

-- Lily shared recipes from arrangement posts
alter table public.florist_community_posts
  add column if not exists recipe_draft jsonb,
  add column if not exists recipe_status text not null default 'none',
  add column if not exists published_recipe_id uuid;

alter table public.florist_community_posts
  drop constraint if exists florist_community_posts_recipe_status_check;

alter table public.florist_community_posts
  add constraint florist_community_posts_recipe_status_check
  check (recipe_status in ('none', 'draft', 'published', 'imported'));

create table if not exists public.florist_community_recipes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.florist_community_posts(id) on delete set null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_shop_id uuid not null references public.shops(id) on delete cascade,
  title text not null,
  description text,
  category text,
  recipe jsonb not null default '[]'::jsonb,
  instructions jsonb not null default '[]'::jsonb,
  suggested_retail numeric(12,2) not null default 0,
  image_path text,
  status text not null default 'active'
    check (status in ('active', 'hidden', 'removed')),
  import_count integer not null default 0 check (import_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists florist_community_recipes_post_idx
  on public.florist_community_recipes (post_id);

create index if not exists florist_community_recipes_feed_idx
  on public.florist_community_recipes (status, created_at desc);

alter table public.florist_community_recipes enable row level security;

drop policy if exists "community recipes read active" on public.florist_community_recipes;
create policy "community recipes read active"
  on public.florist_community_recipes
  for select
  to authenticated
  using (
    status = 'active'
    and public.is_active_florist()
  );

drop policy if exists "community recipes insert own" on public.florist_community_recipes;
create policy "community recipes insert own"
  on public.florist_community_recipes
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_active_member_of(author_shop_id)
  );

drop policy if exists "community recipes update own" on public.florist_community_recipes;
create policy "community recipes update own"
  on public.florist_community_recipes
  for update
  to authenticated
  using (author_user_id = auth.uid() and public.is_active_florist())
  with check (author_user_id = auth.uid() and public.is_active_member_of(author_shop_id));

revoke all on table public.florist_community_recipes from anon;
grant select, insert, update on table public.florist_community_recipes to authenticated;
grant all on table public.florist_community_recipes to service_role;

-- Recipe cover images reuse community post paths
create or replace function public.florist_community_image_readable(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_path is not null
    and length(trim(p_path)) > 0
    and public.is_active_florist()
    and (
      exists (
        select 1
        from public.florist_community_posts p
        where p.image_path = p_path
          and (
            (p.status = 'active')
            or (
              p.status in ('hidden', 'removed')
              and (
                public.is_platform_admin_user()
                or (p.author_user_id = auth.uid())
                or public.is_shop_manager_of(p.shop_id)
              )
            )
          )
      )
      or exists (
        select 1
        from public.florist_community_profiles pr
        where pr.avatar_path = p_path
      )
      or exists (
        select 1
        from public.florist_community_recipes r
        where r.image_path = p_path
          and r.status = 'active'
      )
    );
$$;

notify pgrst, 'reload schema';
