-- Florisyn Florist Community Beta v1 — Correction R1/R2 (security)
-- Apply AFTER 20260731_florist_community_beta_v1.sql
-- Idempotent (safe to re-apply without schema reset). Does NOT touch Staff A2.
-- Do not apply to staging/production until Technical Director approval.

-- ---------------------------------------------------------------------------
-- Internal schema for non-RPC helpers (not exposed to clients)
-- ---------------------------------------------------------------------------

create schema if not exists florisyn_internal;
revoke all on schema florisyn_internal from public;
revoke all on schema florisyn_internal from anon;
revoke all on schema florisyn_internal from authenticated;
grant usage on schema florisyn_internal to postgres;
grant usage on schema florisyn_internal to service_role;

-- ---------------------------------------------------------------------------
-- Production schema compatibility: shop_members.status (guarded, non-destructive)
-- ---------------------------------------------------------------------------

do $$
declare
  has_status boolean;
  status_udt text;
  status_nullable text;
  has_default boolean;
  has_check boolean;
  check_def text;
  found_statuses text[];
  expected_statuses text[] := array['active', 'invited', 'removed', 'suspended'];
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shop_members'
      and column_name = 'status'
  ) into has_status;

  if not has_status then
    alter table public.shop_members add column status text;
    update public.shop_members set status = 'active' where status is null;
    alter table public.shop_members alter column status set default 'active';
    alter table public.shop_members alter column status set not null;
  else
    select c.udt_name, c.is_nullable,
           (c.column_default is not null)
      into status_udt, status_nullable, has_default
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'shop_members'
      and c.column_name = 'status';

    if status_udt not in ('text', 'varchar', 'bpchar') then
      raise exception
        'Community security migration aborted: public.shop_members.status must be a text type (found %).',
        status_udt;
    end if;

    -- Migrate NULL legacy memberships to active deliberately.
    update public.shop_members set status = 'active' where status is null;

    if not has_default then
      alter table public.shop_members alter column status set default 'active';
    end if;

    if status_nullable = 'YES' then
      alter table public.shop_members alter column status set not null;
    end if;
  end if;

  select exists (
    select 1 from pg_constraint
    where conname = 'shop_members_status_check'
      and conrelid = 'public.shop_members'::regclass
  ) into has_check;

  if not has_check then
    -- Fail loudly if incompatible values prevent the required control.
    if exists (
      select 1 from public.shop_members
      where status not in ('active', 'invited', 'suspended', 'removed')
    ) then
      raise exception
        'Community security migration aborted: shop_members.status contains values outside (active, invited, suspended, removed).';
    end if;
    alter table public.shop_members
      add constraint shop_members_status_check
      check (status in ('active', 'invited', 'suspended', 'removed'));
  else
    -- Exact compatibility: must be a positive allowlist of exactly
    -- (active, invited, suspended, removed). Substring presence is not enough.
    select pg_get_constraintdef(oid) into check_def
    from pg_constraint
    where conname = 'shop_members_status_check'
      and conrelid = 'public.shop_members'::regclass;

    if check_def is null then
      raise exception
        'Community security migration aborted: existing shop_members_status_check is incompatible (<null>).';
    end if;

    -- Reject inverted / negative constraints even if they mention the same words.
    if check_def ~* 'not\s+in' or check_def ~* '<>\s*all' then
      raise exception
        'Community security migration aborted: existing shop_members_status_check is inverted/incompatible (%).',
        check_def;
    end if;

    -- Must be a positive allowlist form.
    if not (check_def ~* '\min\s*\(' or check_def ~* '=\s*any\s*\(') then
      raise exception
        'Community security migration aborted: existing shop_members_status_check is not an allowlist (%).',
        check_def;
    end if;

    select coalesce(array_agg(x order by x), array[]::text[])
      into found_statuses
    from (
      select distinct lower(m[1]) as x
      from regexp_matches(lower(check_def), '''([^'']+)''', 'g') as m
    ) s;

    if found_statuses is distinct from expected_statuses then
      raise exception
        'Community security migration aborted: existing shop_members_status_check must permit exactly (active, invited, suspended, removed); found % in (%).',
        coalesce(found_statuses::text, '{}'),
        check_def;
    end if;
  end if;
end $$;

create index if not exists shop_members_active_user_idx
  on public.shop_members (user_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Auth helpers: active florist membership (exactly status = 'active')
-- ---------------------------------------------------------------------------

create or replace function public.is_active_florist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.status = 'active'
  );
$$;

create or replace function public.is_active_member_of(target_shop uuid)
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
      and sm.status = 'active'
  );
$$;

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
      and sm.status = 'active'
      and lower(sm.role) in ('owner', 'manager', 'admin')
  );
$$;

create or replace function public.florist_community_post_visible(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.florist_community_posts p
    where p.id = p_post_id
      and (
        p.status = 'active'
        or p.author_user_id = auth.uid()
        or public.is_platform_admin_user()
        or public.is_shop_manager_of(p.shop_id)
      )
  );
$$;

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
    and exists (
      select 1
      from public.florist_community_posts p
      where p.image_path = p_path
        and (
          -- Active-post images: any active florist
          (p.status = 'active' and public.is_active_florist())
          -- Moderated images: active author, active shop manager, or platform admin
          or (
            p.status in ('hidden', 'removed')
            and (
              public.is_platform_admin_user()
              or (
                p.author_user_id = auth.uid()
                and public.is_active_florist()
              )
              or public.is_shop_manager_of(p.shop_id)
            )
          )
        )
    );
$$;

revoke all on function public.is_active_florist() from public;
revoke all on function public.is_active_florist() from anon;
grant execute on function public.is_active_florist() to authenticated;
grant execute on function public.is_active_florist() to service_role;

revoke all on function public.is_active_member_of(uuid) from public;
revoke all on function public.is_active_member_of(uuid) from anon;
grant execute on function public.is_active_member_of(uuid) to authenticated;
grant execute on function public.is_active_member_of(uuid) to service_role;

revoke all on function public.is_platform_admin_user() from public;
revoke all on function public.is_platform_admin_user() from anon;
grant execute on function public.is_platform_admin_user() to authenticated;
grant execute on function public.is_platform_admin_user() to service_role;

revoke all on function public.is_shop_manager_of(uuid) from public;
revoke all on function public.is_shop_manager_of(uuid) from anon;
grant execute on function public.is_shop_manager_of(uuid) to authenticated;
grant execute on function public.is_shop_manager_of(uuid) to service_role;

revoke all on function public.florist_community_post_visible(uuid) from public;
revoke all on function public.florist_community_post_visible(uuid) from anon;
grant execute on function public.florist_community_post_visible(uuid) to authenticated;
grant execute on function public.florist_community_post_visible(uuid) to service_role;

revoke all on function public.florist_community_image_readable(text) from public;
revoke all on function public.florist_community_image_readable(text) from anon;
grant execute on function public.florist_community_image_readable(text) to authenticated;
grant execute on function public.florist_community_image_readable(text) to service_role;

-- ---------------------------------------------------------------------------
-- Indexes for parent-post / image-path authorization
-- ---------------------------------------------------------------------------

create index if not exists florist_community_posts_image_path_idx
  on public.florist_community_posts (image_path)
  where image_path is not null;

create index if not exists florist_community_posts_status_shop_idx
  on public.florist_community_posts (shop_id, status);

create index if not exists florist_community_comments_post_status_idx
  on public.florist_community_comments (post_id, status);

create index if not exists florist_community_likes_post_idx
  on public.florist_community_likes (post_id);

-- ---------------------------------------------------------------------------
-- Field guards (internal) + triggers
-- ---------------------------------------------------------------------------

create or replace function florisyn_internal.florist_community_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('florisyn.community_bypass_guard', true) = 'on' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.image_path is not null
       and NEW.image_path !~ ('^' || NEW.shop_id::text || '/' || NEW.author_user_id::text || '/.+') then
      raise exception 'Community image_path must be under shop/author prefix.';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.id is distinct from OLD.id
       or NEW.author_user_id is distinct from OLD.author_user_id
       or NEW.shop_id is distinct from OLD.shop_id
       or NEW.like_count is distinct from OLD.like_count
       or NEW.comment_count is distinct from OLD.comment_count
       or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Community post protected fields cannot be changed directly.';
    end if;
    if NEW.status is distinct from OLD.status then
      raise exception 'Community post moderation status can only change via moderate RPC.';
    end if;
    if NEW.image_path is not null
       and NEW.image_path !~ ('^' || NEW.shop_id::text || '/' || NEW.author_user_id::text || '/.+') then
      raise exception 'Community image_path must be under shop/author prefix.';
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

-- public stub retained for revoke/grant inventory; trigger uses florisyn_internal only.
create or replace function public.florist_community_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_posts_guard must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_posts_guard_trg on public.florist_community_posts;
create trigger florist_community_posts_guard_trg
  before insert or update on public.florist_community_posts
  for each row execute function florisyn_internal.florist_community_posts_guard();

create or replace function florisyn_internal.florist_community_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('florisyn.community_bypass_guard', true) = 'on' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if NEW.id is distinct from OLD.id
       or NEW.post_id is distinct from OLD.post_id
       or NEW.author_user_id is distinct from OLD.author_user_id
       or NEW.shop_id is distinct from OLD.shop_id
       or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Community comment protected fields cannot be changed directly.';
    end if;
    if NEW.status is distinct from OLD.status then
      raise exception 'Community comment moderation status can only change via moderate RPC.';
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

create or replace function public.florist_community_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_comments_guard must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_comments_guard_trg on public.florist_community_comments;
create trigger florist_community_comments_guard_trg
  before update on public.florist_community_comments
  for each row execute function florisyn_internal.florist_community_comments_guard();

create or replace function florisyn_internal.florist_community_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.user_id is distinct from OLD.user_id
       or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Community profile identity fields cannot be changed.';
    end if;
    if NEW.shop_id is distinct from OLD.shop_id
       and not public.is_active_member_of(NEW.shop_id) then
      raise exception 'Community profile shop must be an active membership.';
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

create or replace function public.florist_community_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_profiles_guard must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_profiles_guard_trg on public.florist_community_profiles;
create trigger florist_community_profiles_guard_trg
  before update on public.florist_community_profiles
  for each row execute function florisyn_internal.florist_community_profiles_guard();

create or replace function florisyn_internal.florist_community_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('florisyn.community_bypass_guard', true) = 'on' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if NEW.id is distinct from OLD.id
       or NEW.post_id is distinct from OLD.post_id
       or NEW.reporter_user_id is distinct from OLD.reporter_user_id
       or NEW.reporter_shop_id is distinct from OLD.reporter_shop_id
       or NEW.reason is distinct from OLD.reason
       or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Community report protected fields cannot be changed.';
    end if;
    if NEW.status is distinct from OLD.status then
      raise exception 'Community report status can only change via moderate RPC.';
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.florist_community_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_reports_guard must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_reports_guard_trg on public.florist_community_reports;
create trigger florist_community_reports_guard_trg
  before update on public.florist_community_reports
  for each row execute function florisyn_internal.florist_community_reports_guard();

revoke all on function florisyn_internal.florist_community_posts_guard() from public;
revoke all on function florisyn_internal.florist_community_posts_guard() from anon;
revoke all on function florisyn_internal.florist_community_posts_guard() from authenticated;
revoke all on function florisyn_internal.florist_community_comments_guard() from public;
revoke all on function florisyn_internal.florist_community_comments_guard() from anon;
revoke all on function florisyn_internal.florist_community_comments_guard() from authenticated;
revoke all on function florisyn_internal.florist_community_profiles_guard() from public;
revoke all on function florisyn_internal.florist_community_profiles_guard() from anon;
revoke all on function florisyn_internal.florist_community_profiles_guard() from authenticated;
revoke all on function florisyn_internal.florist_community_reports_guard() from public;
revoke all on function florisyn_internal.florist_community_reports_guard() from anon;
revoke all on function florisyn_internal.florist_community_reports_guard() from authenticated;

revoke all on function public.florist_community_posts_guard() from public;
revoke all on function public.florist_community_posts_guard() from anon;
revoke all on function public.florist_community_posts_guard() from authenticated;
grant execute on function public.florist_community_posts_guard() to service_role;

revoke all on function public.florist_community_comments_guard() from public;
revoke all on function public.florist_community_comments_guard() from anon;
revoke all on function public.florist_community_comments_guard() from authenticated;
grant execute on function public.florist_community_comments_guard() to service_role;

revoke all on function public.florist_community_profiles_guard() from public;
revoke all on function public.florist_community_profiles_guard() from anon;
revoke all on function public.florist_community_profiles_guard() from authenticated;
grant execute on function public.florist_community_profiles_guard() to service_role;

revoke all on function public.florist_community_reports_guard() from public;
revoke all on function public.florist_community_reports_guard() from anon;
revoke all on function public.florist_community_reports_guard() from authenticated;
grant execute on function public.florist_community_reports_guard() to service_role;

-- ---------------------------------------------------------------------------
-- Atomic counters (internal)
-- ---------------------------------------------------------------------------

create or replace function florisyn_internal.florist_community_like_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('florisyn.community_bypass_guard', 'on', true);
  if TG_OP = 'INSERT' then
    update public.florist_community_posts
      set like_count = like_count + 1, updated_at = now()
      where id = NEW.post_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update public.florist_community_posts
      set like_count = greatest(0, like_count - 1), updated_at = now()
      where id = OLD.post_id;
    return OLD;
  end if;
  return null;
end;
$$;

create or replace function public.florist_community_like_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_like_counter must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_like_counter_ins on public.florist_community_likes;
drop trigger if exists florist_community_like_counter_del on public.florist_community_likes;
create trigger florist_community_like_counter_ins
  after insert on public.florist_community_likes
  for each row execute function florisyn_internal.florist_community_like_counter();
create trigger florist_community_like_counter_del
  after delete on public.florist_community_likes
  for each row execute function florisyn_internal.florist_community_like_counter();

create or replace function florisyn_internal.florist_community_comment_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('florisyn.community_bypass_guard', 'on', true);
  if TG_OP = 'INSERT' then
    if NEW.status = 'active' then
      update public.florist_community_posts
        set comment_count = comment_count + 1, updated_at = now()
        where id = NEW.post_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.status = 'active' then
      update public.florist_community_posts
        set comment_count = greatest(0, comment_count - 1), updated_at = now()
        where id = OLD.post_id;
    end if;
    return OLD;
  elsif TG_OP = 'UPDATE' then
    if OLD.status = 'active' and NEW.status is distinct from 'active' then
      update public.florist_community_posts
        set comment_count = greatest(0, comment_count - 1), updated_at = now()
        where id = NEW.post_id;
    elsif OLD.status is distinct from 'active' and NEW.status = 'active' then
      update public.florist_community_posts
        set comment_count = comment_count + 1, updated_at = now()
        where id = NEW.post_id;
    end if;
    return NEW;
  end if;
  return null;
end;
$$;

create or replace function public.florist_community_comment_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'florist_community_comment_counter must run via florisyn_internal trigger';
end;
$$;

drop trigger if exists florist_community_comment_counter_ins on public.florist_community_comments;
drop trigger if exists florist_community_comment_counter_del on public.florist_community_comments;
drop trigger if exists florist_community_comment_counter_upd on public.florist_community_comments;
create trigger florist_community_comment_counter_ins
  after insert on public.florist_community_comments
  for each row execute function florisyn_internal.florist_community_comment_counter();
create trigger florist_community_comment_counter_del
  after delete on public.florist_community_comments
  for each row execute function florisyn_internal.florist_community_comment_counter();
create trigger florist_community_comment_counter_upd
  after update of status on public.florist_community_comments
  for each row execute function florisyn_internal.florist_community_comment_counter();

revoke all on function florisyn_internal.florist_community_like_counter() from public;
revoke all on function florisyn_internal.florist_community_like_counter() from anon;
revoke all on function florisyn_internal.florist_community_like_counter() from authenticated;
revoke all on function florisyn_internal.florist_community_comment_counter() from public;
revoke all on function florisyn_internal.florist_community_comment_counter() from anon;
revoke all on function florisyn_internal.florist_community_comment_counter() from authenticated;

revoke all on function public.florist_community_like_counter() from public;
revoke all on function public.florist_community_like_counter() from anon;
revoke all on function public.florist_community_like_counter() from authenticated;
grant execute on function public.florist_community_like_counter() to service_role;

revoke all on function public.florist_community_comment_counter() from public;
revoke all on function public.florist_community_comment_counter() from anon;
revoke all on function public.florist_community_comment_counter() from authenticated;
grant execute on function public.florist_community_comment_counter() to service_role;

drop function if exists public.florist_community_adjust_like_count(uuid, integer);

-- ---------------------------------------------------------------------------
-- Hardened client RPCs
-- ---------------------------------------------------------------------------

create or replace function public.florist_community_toggle_like(p_post_id uuid, p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  liked boolean;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_post_id is null or p_shop_id is null then
    raise exception 'post_id and shop_id are required' using errcode = '22023';
  end if;
  if not public.is_active_member_of(p_shop_id) then
    raise exception 'Active florist membership required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.florist_community_posts p
    where p.id = p_post_id and p.status = 'active'
  ) then
    raise exception 'Post is not available' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.florist_community_likes l
    where l.post_id = p_post_id and l.user_id = uid
  ) then
    delete from public.florist_community_likes
      where post_id = p_post_id and user_id = uid;
    liked := false;
  else
    insert into public.florist_community_likes (post_id, user_id, shop_id)
    values (p_post_id, uid, p_shop_id)
    on conflict (post_id, user_id) do nothing;
    liked := exists (
      select 1 from public.florist_community_likes l
      where l.post_id = p_post_id and l.user_id = uid
    );
  end if;

  return jsonb_build_object(
    'liked', liked,
    'like_count', (
      select p.like_count from public.florist_community_posts p where p.id = p_post_id
    )
  );
end;
$$;

create or replace function public.florist_community_report_post(
  p_post_id uuid,
  p_shop_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  reason_clean text := left(trim(coalesce(p_reason, '')), 500);
  inserted boolean := false;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_member_of(p_shop_id) then
    raise exception 'Active florist membership required' using errcode = '42501';
  end if;
  if char_length(reason_clean) < 3 then
    raise exception 'Report reason is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.florist_community_posts p
    where p.id = p_post_id and p.status = 'active'
  ) then
    raise exception 'Post is not available' using errcode = 'P0002';
  end if;

  insert into public.florist_community_reports (
    post_id, reporter_user_id, reporter_shop_id, reason, status
  ) values (
    p_post_id, uid, p_shop_id, reason_clean, 'open'
  )
  on conflict (post_id, reporter_user_id) do nothing
  returning id into rid;

  if rid is not null then
    inserted := true;
  else
    select r.id into rid
    from public.florist_community_reports r
    where r.post_id = p_post_id and r.reporter_user_id = uid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_reported', not inserted,
    'id', rid,
    'message', case
      when inserted then 'Thanks — moderators will review this post.'
      else 'Report already submitted.'
    end
  );
end;
$$;

create or replace function public.florist_community_moderate_post(
  p_post_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  post_shop uuid;
  new_status text := lower(trim(coalesce(p_status, '')));
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if new_status not in ('hidden', 'removed') then
    raise exception 'Invalid moderation status' using errcode = '22023';
  end if;
  select p.shop_id into post_shop
  from public.florist_community_posts p
  where p.id = p_post_id;
  if post_shop is null then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_platform_admin_user()
    or public.is_shop_manager_of(post_shop)
  ) then
    raise exception 'Not authorized to moderate' using errcode = '42501';
  end if;

  perform set_config('florisyn.community_bypass_guard', 'on', true);
  update public.florist_community_posts
    set status = new_status, updated_at = now()
    where id = p_post_id;

  return jsonb_build_object('ok', true, 'status', new_status);
end;
$$;

create or replace function public.florist_community_moderate_comment(
  p_comment_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  comment_shop uuid;
  new_status text := lower(trim(coalesce(p_status, '')));
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if new_status not in ('hidden', 'removed') then
    raise exception 'Invalid moderation status' using errcode = '22023';
  end if;
  select c.shop_id into comment_shop
  from public.florist_community_comments c
  where c.id = p_comment_id;
  if comment_shop is null then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_platform_admin_user()
    or public.is_shop_manager_of(comment_shop)
  ) then
    raise exception 'Not authorized to moderate' using errcode = '42501';
  end if;

  perform set_config('florisyn.community_bypass_guard', 'on', true);
  update public.florist_community_comments
    set status = new_status, updated_at = now()
    where id = p_comment_id;

  return jsonb_build_object('ok', true, 'status', new_status);
end;
$$;

create or replace function public.florist_community_moderate_report(
  p_report_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_status text := lower(trim(coalesce(p_status, '')));
  old_reason text;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if new_status not in ('reviewed', 'dismissed') then
    raise exception 'Invalid report moderation status' using errcode = '22023';
  end if;
  if not public.is_platform_admin_user() then
    raise exception 'Not authorized to moderate reports' using errcode = '42501';
  end if;

  select r.reason into old_reason
  from public.florist_community_reports r
  where r.id = p_report_id;
  if old_reason is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  perform set_config('florisyn.community_bypass_guard', 'on', true);
  update public.florist_community_reports
    set status = new_status
    where id = p_report_id;

  return jsonb_build_object('ok', true, 'status', new_status, 'reason_unchanged', true);
end;
$$;

revoke all on function public.florist_community_toggle_like(uuid, uuid) from public;
revoke all on function public.florist_community_toggle_like(uuid, uuid) from anon;
grant execute on function public.florist_community_toggle_like(uuid, uuid) to authenticated;
grant execute on function public.florist_community_toggle_like(uuid, uuid) to service_role;

revoke all on function public.florist_community_report_post(uuid, uuid, text) from public;
revoke all on function public.florist_community_report_post(uuid, uuid, text) from anon;
grant execute on function public.florist_community_report_post(uuid, uuid, text) to authenticated;
grant execute on function public.florist_community_report_post(uuid, uuid, text) to service_role;

revoke all on function public.florist_community_moderate_post(uuid, text) from public;
revoke all on function public.florist_community_moderate_post(uuid, text) from anon;
grant execute on function public.florist_community_moderate_post(uuid, text) to authenticated;
grant execute on function public.florist_community_moderate_post(uuid, text) to service_role;

revoke all on function public.florist_community_moderate_comment(uuid, text) from public;
revoke all on function public.florist_community_moderate_comment(uuid, text) from anon;
grant execute on function public.florist_community_moderate_comment(uuid, text) to authenticated;
grant execute on function public.florist_community_moderate_comment(uuid, text) to service_role;

revoke all on function public.florist_community_moderate_report(uuid, text) from public;
revoke all on function public.florist_community_moderate_report(uuid, text) from anon;
grant execute on function public.florist_community_moderate_report(uuid, text) to authenticated;
grant execute on function public.florist_community_moderate_report(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Replace RLS policies — drop every R1/v1 policy name before recreate
-- ---------------------------------------------------------------------------

-- Profiles
drop policy if exists "community profiles select authenticated" on public.florist_community_profiles;
drop policy if exists "community profiles select active florist" on public.florist_community_profiles;
create policy "community profiles select active florist"
  on public.florist_community_profiles
  for select
  to authenticated
  using (public.is_active_florist() or public.is_platform_admin_user());

drop policy if exists "community profiles insert own" on public.florist_community_profiles;
create policy "community profiles insert own"
  on public.florist_community_profiles
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_member_of(shop_id)
  );

drop policy if exists "community profiles update own" on public.florist_community_profiles;
create policy "community profiles update own"
  on public.florist_community_profiles
  for update
  to authenticated
  using (user_id = auth.uid() and public.is_active_florist())
  with check (
    user_id = auth.uid()
    and public.is_active_member_of(shop_id)
  );

-- Posts
drop policy if exists "community posts select" on public.florist_community_posts;
create policy "community posts select"
  on public.florist_community_posts
  for select
  to authenticated
  using (
    (
      public.is_active_florist()
      and status = 'active'
    )
    or (
      -- Narrow exceptions: author or authorized moderators may read moderated rows.
      public.is_active_florist()
      and author_user_id = auth.uid()
    )
    or public.is_platform_admin_user()
    or (
      public.is_active_florist()
      and public.is_shop_manager_of(shop_id)
    )
  );

drop policy if exists "community posts insert" on public.florist_community_posts;
create policy "community posts insert"
  on public.florist_community_posts
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_active_member_of(shop_id)
    and status = 'active'
    and like_count = 0
    and comment_count = 0
    and (
      image_path is null
      or image_path ~ ('^' || shop_id::text || '/' || author_user_id::text || '/.+')
    )
  );

drop policy if exists "community posts update" on public.florist_community_posts;
drop policy if exists "community posts update author content" on public.florist_community_posts;
drop policy if exists "community posts update moderator" on public.florist_community_posts;
-- Authors may edit supported content fields on their own ACTIVE content only.
-- No moderator UPDATE policy — moderation is status-only via RPC.
create policy "community posts update author content"
  on public.florist_community_posts
  for update
  to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_active_florist()
    and status = 'active'
  )
  with check (
    author_user_id = auth.uid()
    and public.is_active_member_of(shop_id)
    and status = 'active'
    and (
      image_path is null
      or image_path ~ ('^' || shop_id::text || '/' || author_user_id::text || '/.+')
    )
  );

drop policy if exists "community posts delete" on public.florist_community_posts;
-- Authors may hard-delete own rows. Moderators cannot hard-delete.
create policy "community posts delete"
  on public.florist_community_posts
  for delete
  to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_active_florist()
  );

-- Comments
drop policy if exists "community comments select" on public.florist_community_comments;
create policy "community comments select"
  on public.florist_community_comments
  for select
  to authenticated
  using (
    public.florist_community_post_visible(post_id)
    and (
      (
        public.is_active_florist()
        and status = 'active'
        and exists (
          select 1 from public.florist_community_posts p
          where p.id = post_id and p.status = 'active'
        )
      )
      or (
        public.is_active_florist()
        and author_user_id = auth.uid()
      )
      or public.is_platform_admin_user()
      or (
        public.is_active_florist()
        and public.is_shop_manager_of(shop_id)
      )
    )
  );

drop policy if exists "community comments insert" on public.florist_community_comments;
create policy "community comments insert"
  on public.florist_community_comments
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_active_member_of(shop_id)
    and status = 'active'
    and exists (
      select 1 from public.florist_community_posts p
      where p.id = post_id and p.status = 'active'
    )
  );

drop policy if exists "community comments update" on public.florist_community_comments;
drop policy if exists "community comments update author content" on public.florist_community_comments;
create policy "community comments update author content"
  on public.florist_community_comments
  for update
  to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_active_florist()
    and status = 'active'
  )
  with check (
    author_user_id = auth.uid()
    and public.is_active_member_of(shop_id)
    and status = 'active'
  );

drop policy if exists "community comments delete" on public.florist_community_comments;
create policy "community comments delete"
  on public.florist_community_comments
  for delete
  to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_active_florist()
  );

-- Likes
drop policy if exists "community likes select" on public.florist_community_likes;
create policy "community likes select"
  on public.florist_community_likes
  for select
  to authenticated
  using (
    public.is_active_florist()
    and (
      exists (
        select 1 from public.florist_community_posts p
        where p.id = post_id and p.status = 'active'
      )
      or public.is_platform_admin_user()
      or exists (
        select 1 from public.florist_community_posts p
        where p.id = post_id
          and (
            p.author_user_id = auth.uid()
            or public.is_shop_manager_of(p.shop_id)
          )
      )
    )
  );

drop policy if exists "community likes insert" on public.florist_community_likes;
create policy "community likes insert"
  on public.florist_community_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_member_of(shop_id)
    and exists (
      select 1 from public.florist_community_posts p
      where p.id = post_id and p.status = 'active'
    )
  );

drop policy if exists "community likes delete" on public.florist_community_likes;
create policy "community likes delete"
  on public.florist_community_likes
  for delete
  to authenticated
  using (user_id = auth.uid() and public.is_active_florist());

-- Reports: insert + select only; no direct UPDATE/DELETE policies
drop policy if exists "community reports insert" on public.florist_community_reports;
create policy "community reports insert"
  on public.florist_community_reports
  for insert
  to authenticated
  with check (
    reporter_user_id = auth.uid()
    and public.is_active_member_of(reporter_shop_id)
    and status = 'open'
    and exists (
      select 1 from public.florist_community_posts p
      where p.id = post_id and p.status = 'active'
    )
  );

drop policy if exists "community reports select own or admin" on public.florist_community_reports;
create policy "community reports select own or admin"
  on public.florist_community_reports
  for select
  to authenticated
  using (
    (
      public.is_active_florist()
      and reporter_user_id = auth.uid()
    )
    or public.is_platform_admin_user()
  );

drop policy if exists "community reports update admin" on public.florist_community_reports;
-- Intentionally no UPDATE/DELETE policies for reports (status via RPC only).

-- ---------------------------------------------------------------------------
-- Private storage bucket + active-post image readability
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
create policy "community images select active florist"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'florist-community'
    and public.florist_community_image_readable(name)
  );

drop policy if exists "community images insert member" on storage.objects;
create policy "community images insert member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'florist-community'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active_member_of((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "community images update" on storage.objects;

drop policy if exists "community images delete own" on storage.objects;
-- Only the active image owner may directly delete their object.
-- Managers/platform admins moderate via status-only RPCs; service_role cleanup remains.
create policy "community images delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'florist-community'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active_florist()
  );

drop policy if exists "community images service role" on storage.objects;
create policy "community images service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'florist-community')
  with check (bucket_id = 'florist-community');

-- ---------------------------------------------------------------------------
-- Explicit minimum table privileges (production-shaped; no broad anon access)
-- ---------------------------------------------------------------------------

revoke all on table public.florist_community_profiles from anon;
revoke all on table public.florist_community_posts from anon;
revoke all on table public.florist_community_comments from anon;
revoke all on table public.florist_community_likes from anon;
revoke all on table public.florist_community_reports from anon;

grant select, insert, update on table public.florist_community_profiles to authenticated;
grant select, insert, update, delete on table public.florist_community_posts to authenticated;
grant select, insert, update, delete on table public.florist_community_comments to authenticated;
grant select, insert, delete on table public.florist_community_likes to authenticated;
grant select, insert on table public.florist_community_reports to authenticated;

grant all on table public.florist_community_profiles to service_role;
grant all on table public.florist_community_posts to service_role;
grant all on table public.florist_community_comments to service_role;
grant all on table public.florist_community_likes to service_role;
grant all on table public.florist_community_reports to service_role;

notify pgrst, 'reload schema';
