-- Homecoming/Prom order inspiration photos — private storage bucket.
-- NOT YET APPLIED to any Supabase project, and deliberately kept in
-- supabase/pending_migrations/ (not supabase/migrations/) — the latter is a
-- gated, reviewed canonical list asserted file-for-file by
-- tests/florisyn-live-schema-snapshot.test.js ("canonical executable
-- migrations have unique timestamp identities"). Ashley/ChatGPT: once this
-- is reviewed and actually applied to a real Supabase project, `git mv` it
-- into supabase/migrations/ and add it to that test's expected file list in
-- the same change.
-- See netlify/functions/_shared/order-attachments.js for the app code that
-- reads/writes this bucket, and orders.js for how the resulting storage
-- path is saved on orders.metadata.homecoming_prom.inspiration_photo_path.
--
-- Modeled directly on the existing delivery-proofs bucket
-- (20260804000000_greenfield_baseline.sql, "Florisyn Daily Loop v3 —
-- private delivery proof storage bucket"): same private-bucket /
-- shop-id-path-prefix / signed-URL-only pattern, kept as its own bucket so
-- this feature's lifecycle and policies can evolve independently.
--
-- Object path convention (application): {shop_id}/{timestamp}-{uuid}.{ext}
-- Safe to re-run (ON CONFLICT / DROP POLICY IF EXISTS).
--
-- Bucket is PRIVATE (public = false). Access via createSignedUrl only (~300s TTL in app).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-attachments',
  'order-attachments',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Shop-scoped RLS on storage.objects — first path segment MUST be shop_id (uuid)
-- Uses public.is_shop_member() (same tenant model as table RLS and as the
-- delivery-proofs bucket above).
-- Authenticated florists only; no anonymous or public object URLs.
-- ---------------------------------------------------------------------------

drop policy if exists "order attachments shop member select" on storage.objects;
create policy "order attachments shop member select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "order attachments shop member insert" on storage.objects;
create policy "order attachments shop member insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "order attachments shop member update" on storage.objects;
create policy "order attachments shop member update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "order attachments shop member delete" on storage.objects;
create policy "order attachments shop member delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

-- Service role bypass for break-glass admin / migrations (Netlify functions use user JWT by default)
drop policy if exists "order attachments service role" on storage.objects;
create policy "order attachments service role"
on storage.objects
for all
to service_role
using (bucket_id = 'order-attachments')
with check (bucket_id = 'order-attachments');
