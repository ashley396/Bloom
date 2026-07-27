-- Bloom Marketplace verification production v1 (idempotent, forward-only).
-- Not applied to live Supabase until manually reviewed and run.

create extension if not exists pgcrypto;

create table if not exists public.marketplace_verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  florist_shop_id uuid references public.shops(id) on delete set null,
  wholesaler_shop_id uuid references public.shops(id) on delete set null,
  status text not null default 'draft' check (
    status in (
      'draft',
      'submitted',
      'under_review',
      'more_info_required',
      'approved',
      'rejected',
      'expired',
      'suspended'
    )
  ),
  consent_confirmed boolean not null default false,
  consent_at timestamptz,
  profile_data jsonb not null default '{}'::jsonb,
  review_history jsonb not null default '[]'::jsonb,
  review_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  documents_expire_at timestamptz,
  approval_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.marketplace_verification_applications
  add column if not exists florist_shop_id uuid references public.shops(id) on delete set null;

alter table public.marketplace_verification_applications
  add column if not exists wholesaler_shop_id uuid references public.shops(id) on delete set null;

alter table public.marketplace_verification_applications
  add column if not exists consent_at timestamptz;

alter table public.marketplace_verification_applications
  add column if not exists documents_expire_at timestamptz;

alter table public.marketplace_verification_applications
  add column if not exists approval_expires_at timestamptz;

create table if not exists public.marketplace_verification_tax_secrets (
  application_id uuid primary key references public.marketplace_verification_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tax_id_ciphertext bytea not null,
  tax_id_last_four text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_verification_audit_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.marketplace_verification_applications(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_verification_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  recipient_email text,
  event_type text not null,
  application_id uuid references public.marketplace_verification_applications(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.marketplace_verification_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_verification_set_updated_at on public.marketplace_verification_applications;
create trigger marketplace_verification_set_updated_at
before update on public.marketplace_verification_applications
for each row execute function public.marketplace_verification_set_updated_at();

create or replace function public.marketplace_verification_tax_secrets_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_verification_tax_secrets_set_updated_at on public.marketplace_verification_tax_secrets;
create trigger marketplace_verification_tax_secrets_set_updated_at
before update on public.marketplace_verification_tax_secrets
for each row execute function public.marketplace_verification_tax_secrets_set_updated_at();

create index if not exists marketplace_verification_applications_user_id_idx
  on public.marketplace_verification_applications (user_id);

create index if not exists marketplace_verification_applications_status_idx
  on public.marketplace_verification_applications (status);

create index if not exists marketplace_verification_applications_florist_shop_idx
  on public.marketplace_verification_applications (florist_shop_id);

create index if not exists marketplace_verification_applications_wholesaler_shop_idx
  on public.marketplace_verification_applications (wholesaler_shop_id);

create index if not exists marketplace_verification_audit_application_idx
  on public.marketplace_verification_audit_events (application_id, created_at desc);

create index if not exists marketplace_verification_email_outbox_status_idx
  on public.marketplace_verification_email_outbox (status, created_at desc);

alter table public.marketplace_verification_applications enable row level security;
alter table public.marketplace_verification_tax_secrets enable row level security;
alter table public.marketplace_verification_audit_events enable row level security;
alter table public.marketplace_verification_email_outbox enable row level security;

drop policy if exists "marketplace applications owner access" on public.marketplace_verification_applications;
create policy "marketplace applications owner access" on public.marketplace_verification_applications
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "marketplace applications service role access" on public.marketplace_verification_applications;
create policy "marketplace applications service role access" on public.marketplace_verification_applications
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "marketplace verification tax secrets service role" on public.marketplace_verification_tax_secrets;
create policy "marketplace verification tax secrets service role" on public.marketplace_verification_tax_secrets
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "marketplace verification audit service role" on public.marketplace_verification_audit_events;
create policy "marketplace verification audit service role" on public.marketplace_verification_audit_events
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "marketplace verification email service role" on public.marketplace_verification_email_outbox;
create policy "marketplace verification email service role" on public.marketplace_verification_email_outbox
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketplace-verification-documents',
  'marketplace-verification-documents',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketplace verification docs owner read" on storage.objects;
create policy "marketplace verification docs owner read" on storage.objects
for select to authenticated
using (
  bucket_id = 'marketplace-verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "marketplace verification docs owner insert" on storage.objects;
create policy "marketplace verification docs owner insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'marketplace-verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "marketplace verification docs owner update" on storage.objects;
create policy "marketplace verification docs owner update" on storage.objects
for update to authenticated
using (
  bucket_id = 'marketplace-verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'marketplace-verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "marketplace verification docs owner delete" on storage.objects;
create policy "marketplace verification docs owner delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'marketplace-verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "marketplace verification docs service role" on storage.objects;
create policy "marketplace verification docs service role" on storage.objects
for all to service_role
using (bucket_id = 'marketplace-verification-documents')
with check (bucket_id = 'marketplace-verification-documents');

notify pgrst, 'reload schema';
