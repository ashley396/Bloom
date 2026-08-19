-- Community Step 68: real Following relationships and notifications.
-- Search doesn't need new schema (ILIKE over existing caption/body).

create table if not exists public.florist_community_follows (
  follower_user_id uuid not null references auth.users (id) on delete cascade,
  followed_user_id uuid not null references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id),
  constraint florist_community_follows_no_self_follow check (follower_user_id <> followed_user_id)
);

create index if not exists florist_community_follows_followed_idx
  on public.florist_community_follows (followed_user_id);

alter table public.florist_community_follows enable row level security;

drop policy if exists "community follows select" on public.florist_community_follows;
create policy "community follows select" on public.florist_community_follows
  for select using (is_active_florist());

drop policy if exists "community follows insert" on public.florist_community_follows;
create policy "community follows insert" on public.florist_community_follows
  for insert with check (
    follower_user_id = auth.uid()
    and is_active_member_of(shop_id)
  );

drop policy if exists "community follows delete" on public.florist_community_follows;
create policy "community follows delete" on public.florist_community_follows
  for delete using (
    follower_user_id = auth.uid()
    and is_active_florist()
  );

create table if not exists public.florist_community_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  shop_id uuid not null references public.shops (id) on delete cascade,
  type text not null,
  post_id uuid references public.florist_community_posts (id) on delete cascade,
  comment_id uuid references public.florist_community_comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint florist_community_notifications_type_check
    check (type in ('like', 'comment', 'follow'))
);

create index if not exists florist_community_notifications_recipient_idx
  on public.florist_community_notifications (recipient_user_id, created_at desc);

alter table public.florist_community_notifications enable row level security;

drop policy if exists "community notifications select own" on public.florist_community_notifications;
create policy "community notifications select own" on public.florist_community_notifications
  for select using (
    recipient_user_id = auth.uid()
    and is_active_florist()
  );

-- Mark-as-read only — a florist never edits who/what triggered a
-- notification, only whether they've seen it.
drop policy if exists "community notifications mark read" on public.florist_community_notifications;
create policy "community notifications mark read" on public.florist_community_notifications
  for update using (
    recipient_user_id = auth.uid()
    and is_active_florist()
  ) with check (
    recipient_user_id = auth.uid()
  );

-- No INSERT policy: a notification is always about *someone else's*
-- action on your content, so the acting florist's own RLS-scoped client
-- can never satisfy "recipient_user_id = auth.uid()". Notifications are
-- written server-side via the service-role client (adminIfConfigured() in
-- netlify/functions/florist-community.js), same pattern already used
-- there for import_count — best-effort, never blocking the real action.

-- Community Step 68 (structured post types) — a real "Mark as answer"
-- workflow for Questions posts, not a cosmetic category relabel. Only the
-- asker can mark it (enforced in netlify/functions/florist-community.js's
-- mark_answered action, which also verifies the comment belongs to this
-- post — RLS on posts already restricts UPDATE to the post's own author).
alter table public.florist_community_posts
  add column if not exists answered_comment_id uuid references public.florist_community_comments (id) on delete set null;
