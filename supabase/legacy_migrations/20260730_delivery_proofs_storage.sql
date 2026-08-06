-- Florisyn Daily Loop v3 — private delivery proof storage bucket
-- Apply AFTER Foundation v1 migration and BEFORE enabling proof capture in production.
-- Safe to re-run (ON CONFLICT / DROP POLICY IF EXISTS).
--
-- Object path convention (application): {shop_id}/{timestamp}-{uuid}.{ext}
-- See netlify/functions/_shared/delivery-proof.js
--
-- Bucket is PRIVATE (public = false). Access via createSignedUrl only (~300s TTL in app).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proofs',
  'delivery-proofs',
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
-- Uses public.is_shop_member() (same tenant model as table RLS).
-- Authenticated florists only; no anonymous or public object URLs.
-- ---------------------------------------------------------------------------

drop policy if exists "delivery proofs shop member select" on storage.objects;
create policy "delivery proofs shop member select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'delivery-proofs'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "delivery proofs shop member insert" on storage.objects;
create policy "delivery proofs shop member insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'delivery-proofs'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "delivery proofs shop member update" on storage.objects;
create policy "delivery proofs shop member update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'delivery-proofs'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'delivery-proofs'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "delivery proofs shop member delete" on storage.objects;
create policy "delivery proofs shop member delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'delivery-proofs'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_shop_member((storage.foldername(name))[1]::uuid)
);

-- Service role bypass for break-glass admin / migrations (Netlify functions use user JWT by default)
drop policy if exists "delivery proofs service role" on storage.objects;
create policy "delivery proofs service role"
on storage.objects
for all
to service_role
using (bucket_id = 'delivery-proofs')
with check (bucket_id = 'delivery-proofs');

notify pgrst, 'reload schema';
