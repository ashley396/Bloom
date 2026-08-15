-- Website Studio — media library (storage bucket + metadata table)
-- Apply after the greenfield baseline (bloom_website_projects/pages already exist).
-- Safe to re-run (ON CONFLICT / DROP POLICY IF EXISTS / IF NOT EXISTS).
--
-- Object path convention (application): {shop_id}/{uuid}.{ext}
-- See netlify/functions/_shared/website-media.js
--
-- Bucket is PUBLIC (public = true) — published florist storefronts are
-- unauthenticated, so hero/product/gallery images must be readable without
-- a signed URL. Writes stay shop-scoped via RLS on storage.objects, same
-- tenant model as the private delivery-proofs bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'website-media',
  'website-media',
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

drop policy if exists "website media public read" on storage.objects;
create policy "website media public read"
on storage.objects
for select
to public
using (bucket_id = 'website-media');

drop policy if exists "website media shop member insert" on storage.objects;
create policy "website media shop member insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'website-media'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "website media shop member update" on storage.objects;
create policy "website media shop member update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'website-media'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'website-media'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "website media shop member delete" on storage.objects;
create policy "website media shop member delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'website-media'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "website media service role" on storage.objects;
create policy "website media service role"
on storage.objects
for all
to service_role
using (bucket_id = 'website-media')
with check (bucket_id = 'website-media');

-- ---------------------------------------------------------------------------
-- Metadata table — filename, alt text, label, source. The bucket alone can't
-- support "browsing, reuse, labeling, and usage visibility" (blueprint
-- requirement); usage-in-sections is computed at read time against the
-- florist's live pages, not denormalized here, to avoid a second place that
-- can drift out of sync with what a page actually references.
-- ---------------------------------------------------------------------------

create table if not exists public.website_media (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  storage_path text not null,
  filename text not null default 'image',
  alt_text text not null default '',
  label text not null default '',
  source text not null default 'upload' check (source in ('upload', 'brand_asset', 'generated', 'library')),
  mime text not null,
  size_bytes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_path)
);

create index if not exists website_media_shop_id_idx on public.website_media (shop_id, created_at desc);

alter table public.website_media enable row level security;

drop policy if exists "website media rows shop" on public.website_media;
create policy "website media rows shop" on public.website_media
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

-- RLS policies alone do not grant table access — Postgres requires the base
-- GRANT too, or `authenticated` gets 42501 permission-denied even with a
-- passing policy. This exact gap (new tables created without this line)
-- caused a prior P0 outage across 57 tables; never skip it on a new table.
grant select, insert, update, delete on public.website_media to authenticated;

notify pgrst, 'reload schema';
