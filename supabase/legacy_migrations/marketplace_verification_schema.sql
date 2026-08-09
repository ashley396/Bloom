create extension if not exists pgcrypto;

create table if not exists public.marketplace_verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','more_info_required','approved','rejected','expired','suspended')),
  consent_confirmed boolean not null default false,
  profile_data jsonb not null default '{}'::jsonb,
  review_history jsonb not null default '[]'::jsonb,
  review_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.marketplace_verification_applications enable row level security;

create or replace function public.marketplace_verification_is_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and auth.uid() = (select user_id from public.marketplace_verification_applications where user_id = auth.uid() limit 1);
$$;

create policy if not exists "marketplace applications owner access" on public.marketplace_verification_applications
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "marketplace applications service role access" on public.marketplace_verification_applications
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create storage bucket if not exists marketplace-verification-documents private;

create or replace function public.marketplace_verification_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_verification_set_updated_at on public.marketplace_verification_applications;
create trigger marketplace_verification_set_updated_at
before update on public.marketplace_verification_applications
for each row execute procedure public.marketplace_verification_set_updated_at();

create index if not exists marketplace_verification_applications_user_id_idx on public.marketplace_verification_applications (user_id);
create index if not exists marketplace_verification_applications_status_idx on public.marketplace_verification_applications (status);
