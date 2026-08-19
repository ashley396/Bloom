-- Florist Community private storage — bucket + florist upload/read policies.
-- Safe to re-run. Apply if photo uploads fail with "Image upload failed".

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

notify pgrst, 'reload schema';
