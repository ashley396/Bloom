-- Florist Network wire reference photos — private bucket + service role access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'florist-wire-photos',
  'florist-wire-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "florist wire photos service role" on storage.objects;
create policy "florist wire photos service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'florist-wire-photos')
  with check (bucket_id = 'florist-wire-photos');

notify pgrst, 'reload schema';
