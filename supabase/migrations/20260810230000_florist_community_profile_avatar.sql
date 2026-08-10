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
