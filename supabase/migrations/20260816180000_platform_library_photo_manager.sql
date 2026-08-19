-- Platform Library Photo Manager — lets a Florisyn platform admin add/edit/
-- remove real photos (Floral Library items and Website Studio hero photos)
-- from the admin console, without a developer editing static files and
-- pushing a deploy. Storage bucket + metadata table, following the same
-- shape as 20260815000000_website_media_library.sql.
--
-- Object path convention (application): platform/{context}/{uuid}.{ext}
-- See netlify/functions/_shared/platform-library-photos.js
--
-- Bucket is PUBLIC (public = true) — florist-facing pages (Floral Library,
-- Website Studio hero picker) load these images directly, unauthenticated,
-- same reasoning as the website-media bucket.
--
-- The metadata table follows the existing platform-admin convention seen
-- on public.platform_admins in the greenfield baseline: RLS is enabled but
-- NO browser-facing policies are created. All reads and writes go through
-- secured Netlify functions using the Supabase service role, after the
-- write path verifies the caller is an active platform admin
-- (netlify/functions/_shared/platform-admin.js's platformAdmin()).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platform-library-media',
  'platform-library-media',
  true,
  8388608,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "platform library media public read" on storage.objects;
create policy "platform library media public read"
on storage.objects
for select
to public
using (bucket_id = 'platform-library-media');

drop policy if exists "platform library media admin write" on storage.objects;
create policy "platform library media admin write"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'platform-library-media'
  and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.active)
)
with check (
  bucket_id = 'platform-library-media'
  and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.active)
);

create table if not exists public.platform_library_photos (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('floral_library', 'website_hero')),
  category text not null,
  name text not null,
  short_description text,
  description text,
  recipe jsonb not null default '[]'::jsonb,
  suggested_retail numeric,
  image_path text not null,
  alt_text text not null,
  source text not null default 'admin_upload',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_library_photos_context_idx
  on public.platform_library_photos (context, category);

alter table public.platform_library_photos enable row level security;
-- No browser-facing policies — see comment above. Netlify functions only.
