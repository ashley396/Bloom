-- Florisyn Florist Community Beta v1 — Correction R1 (security)
-- Apply AFTER 20260731_florist_community_beta_v1.sql
-- Idempotent. Does NOT touch Staff A2. Do not apply to staging/production yet.
--
-- Rollback (high level):
--   1. Drop R1 RPCs/triggers/functions added below
--   2. Re-apply v1 storage/policies if needed from backup
--   Prefer restore from DB backup over destructive rollback.

-- ---------------------------------------------------------------------------
-- Auth helpers: active florist membership (authoritative)
-- ---------------------------------------------------------------------------

create or replace function public.is_active_florist()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and coalesce(sm.status, 'active') = 'active'
  );
$$;

create or replace function public.is_active_member_of(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = target_shop
      and sm.user_id = auth.uid()
      and coalesce(sm.status, 'active') = 'active'
  );
$$;

create or replace function public.is_platform_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and coalesce(pa.active, true) = true
  );
$$;

create or replace function public.is_shop_manager_of(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = target_shop
      and sm.user_id = auth.uid()
      and coalesce(sm.status, 'active') = 'active'
      and lower(sm.role) in ('owner', 'manager', 'admin')
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

-- ---------------------------------------------------------------------------
-- Immutable / moderation field guards
-- ---------------------------------------------------------------------------

create or replace function public.florist_community_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('florisyn.community_bypass_guard', true) = 'on' then
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
      if not (
        public.is_platform_admin_user()
        or public.is_shop_manager_of(OLD.shop_id)
      ) then
        raise exception 'Not authorized to change Community post moderation status.';
      end if;
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists florist_community_posts_guard_trg on public.florist_community_posts;
create trigger florist_community_posts_guard_trg
  before update on public.florist_community_posts
  for each row execute function public.florist_community_posts_guard();

create or replace function public.florist_community_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
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
      if not (
        NEW.author_user_id = auth.uid()
        or public.is_platform_admin_user()
        or public.is_shop_manager_of(OLD.shop_id)
      ) then
        raise exception 'Not authorized to change Community comment status.';
      end if;
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists florist_community_comments_guard_trg on public.florist_community_comments;
create trigger florist_community_comments_guard_trg
  before update on public.florist_community_comments
  for each row execute function public.florist_community_comments_guard();

create or replace function public.florist_community_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists florist_community_profiles_guard_trg on public.florist_community_profiles;
create trigger florist_community_profiles_guard_trg
  before update on public.florist_community_profiles
  for each row execute function public.florist_community_profiles_guard();

create or replace function public.florist_community_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = public
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
       or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Community report protected fields cannot be changed.';
    end if;
    if NEW.status is distinct from OLD.status
       and not public.is_platform_admin_user() then
      raise exception 'Only platform admins may change Community report status.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists florist_community_reports_guard_trg on public.florist_community_reports;
create trigger florist_community_reports_guard_trg
  before update on public.florist_community_reports
  for each row execute function public.florist_community_reports_guard();

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
-- Atomic counters (triggers; bypass post guard via session setting)
-- ---------------------------------------------------------------------------

create or replace function public.florist_community_like_counter()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists florist_community_like_counter_ins on public.florist_community_likes;
drop trigger if exists florist_community_like_counter_del on public.florist_community_likes;
create trigger florist_community_like_counter_ins
  after insert on public.florist_community_likes
  for each row execute function public.florist_community_like_counter();
create trigger florist_community_like_counter_del
  after delete on public.florist_community_likes
  for each row execute function public.florist_community_like_counter();

create or replace function public.florist_community_comment_counter()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists florist_community_comment_counter_ins on public.florist_community_comments;
drop trigger if exists florist_community_comment_counter_del on public.florist_community_comments;
drop trigger if exists florist_community_comment_counter_upd on public.florist_community_comments;
create trigger florist_community_comment_counter_ins
  after insert on public.florist_community_comments
  for each row execute function public.florist_community_comment_counter();
create trigger florist_community_comment_counter_del
  after delete on public.florist_community_comments
  for each row execute function public.florist_community_comment_counter();
create trigger florist_community_comment_counter_upd
  after update of status on public.florist_community_comments
  for each row execute function public.florist_community_comment_counter();

revoke all on function public.florist_community_like_counter() from public;
revoke all on function public.florist_community_like_counter() from anon;
revoke all on function public.florist_community_like_counter() from authenticated;
grant execute on function public.florist_community_like_counter() to service_role;

revoke all on function public.florist_community_comment_counter() from public;
revoke all on function public.florist_community_comment_counter() from anon;
revoke all on function public.florist_community_comment_counter() from authenticated;
grant execute on function public.florist_community_comment_counter() to service_role;

-- Drop missing/legacy RPC if present
drop function if exists public.florist_community_adjust_like_count(uuid, integer);

-- ---------------------------------------------------------------------------
-- Hardened RPCs: toggle like, report (idempotent), moderate
-- ---------------------------------------------------------------------------

create or replace function public.florist_community_toggle_like(p_post_id uuid, p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    liked := true;
  end if;

  return jsonb_build_object(
    'liked', liked,
    'like_count', (
      select like_count from public.florist_community_posts where id = p_post_id
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
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  reason_clean text := left(trim(coalesce(p_reason, '')), 500);
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

  select r.id into rid
  from public.florist_community_reports r
  where r.post_id = p_post_id and r.reporter_user_id = uid;

  if rid is not null then
    return jsonb_build_object(
      'ok', true,
      'already_reported', true,
      'id', rid,
      'message', 'Report already submitted.'
    );
  end if;

  insert into public.florist_community_reports (
    post_id, reporter_user_id, reporter_shop_id, reason, status
  ) values (
    p_post_id, uid, p_shop_id, reason_clean, 'open'
  )
  returning id into rid;

  return jsonb_build_object(
    'ok', true,
    'already_reported', false,
    'id', rid,
    'message', 'Thanks — moderators will review this post.'
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
set search_path = public
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

  update public.florist_community_posts
    set status = new_status, updated_at = now()
    where id = p_post_id;

  return jsonb_build_object('ok', true, 'status', new_status);
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

-- ---------------------------------------------------------------------------
-- Replace RLS policies — active florist required; no anonymous access
-- ---------------------------------------------------------------------------

-- Profiles
drop policy if exists "community profiles select authenticated" on public.florist_community_profiles;
drop policy if exists "community profiles select active florist" on public.florist_community_profiles;
create policy "community profiles select active florist"
  on public.florist_community_profiles
  for select
  to authenticated
  using (public.is_active_florist());

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
    public.is_active_florist()
    and (
      status = 'active'
      or author_user_id = auth.uid()
      or public.is_platform_admin_user()
      or public.is_shop_manager_of(shop_id)
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
  );

drop policy if exists "community posts update" on public.florist_community_posts;
create policy "community posts update author content"
  on public.florist_community_posts
  for update
  to authenticated
  using (author_user_id = auth.uid() and public.is_active_florist())
  with check (author_user_id = auth.uid() and public.is_active_member_of(shop_id));

create policy "community posts update moderator"
  on public.florist_community_posts
  for update
  to authenticated
  using (
    public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  )
  with check (
    public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community posts delete" on public.florist_community_posts;
create policy "community posts delete"
  on public.florist_community_posts
  for delete
  to authenticated
  using (
    (
      author_user_id = auth.uid()
      and public.is_active_florist()
    )
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

-- Comments
drop policy if exists "community comments select" on public.florist_community_comments;
create policy "community comments select"
  on public.florist_community_comments
  for select
  to authenticated
  using (
    public.is_active_florist()
    and (
      status = 'active'
      or author_user_id = auth.uid()
      or public.is_platform_admin_user()
      or public.is_shop_manager_of(shop_id)
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
create policy "community comments update"
  on public.florist_community_comments
  for update
  to authenticated
  using (
    (
      author_user_id = auth.uid()
      and public.is_active_florist()
    )
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  )
  with check (
    (
      author_user_id = auth.uid()
      and public.is_active_member_of(shop_id)
    )
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

drop policy if exists "community comments delete" on public.florist_community_comments;
create policy "community comments delete"
  on public.florist_community_comments
  for delete
  to authenticated
  using (
    (
      author_user_id = auth.uid()
      and public.is_active_florist()
    )
    or public.is_platform_admin_user()
    or public.is_shop_manager_of(shop_id)
  );

-- Likes
drop policy if exists "community likes select" on public.florist_community_likes;
create policy "community likes select"
  on public.florist_community_likes
  for select
  to authenticated
  using (public.is_active_florist());

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

-- Reports: no reporter UPDATE policy (admins only; RPCs use security definer insert)
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
    public.is_active_florist()
    and (
      reporter_user_id = auth.uid()
      or public.is_platform_admin_user()
    )
  );

drop policy if exists "community reports update admin" on public.florist_community_reports;
create policy "community reports update admin"
  on public.florist_community_reports
  for update
  to authenticated
  using (public.is_platform_admin_user())
  with check (public.is_platform_admin_user());

-- ---------------------------------------------------------------------------
-- Private storage bucket + active-florist read
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
    and public.is_active_florist()
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

-- No UPDATE policy — replacement is delete+insert by owner only
drop policy if exists "community images update" on storage.objects;

drop policy if exists "community images delete own" on storage.objects;
create policy "community images delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'florist-community'
    and (
      (
        (storage.foldername(name))[2] = auth.uid()::text
        and public.is_active_florist()
      )
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
