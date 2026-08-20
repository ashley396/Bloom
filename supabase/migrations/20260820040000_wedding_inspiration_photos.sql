-- UX cleanup Part D: wedding inspiration board. Reuses the existing
-- website-media storage bucket/upload pipeline (netlify/functions/_shared/
-- website-media.js) rather than a new storage system — this table only
-- holds the wedding-specific association, caption, and ordering a florist
-- needs on top of an already-uploaded image.

create table if not exists public.wedding_inspiration_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  wedding_id uuid not null references public.wedding_projects(id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wedding_inspiration_photos_wedding_idx
  on public.wedding_inspiration_photos (wedding_id, sort_order);

alter table public.wedding_inspiration_photos enable row level security;

drop policy if exists "wedding inspiration photos shop access" on public.wedding_inspiration_photos;
create policy "wedding inspiration photos shop access"
  on public.wedding_inspiration_photos
  for all
  to authenticated
  using ((select public.is_shop_member(shop_id)))
  with check ((select public.is_shop_member(shop_id)));

-- RLS policies alone do not grant table access — Postgres requires the base
-- GRANT too, or `authenticated` gets 42501 permission-denied even with a
-- passing policy.
grant select, insert, update, delete on public.wedding_inspiration_photos to authenticated;

notify pgrst, 'reload schema';
