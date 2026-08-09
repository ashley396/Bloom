-- Release Candidate v1 — beta feedback inbox (review before apply; forward-only).

create table if not exists public.platform_beta_feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  category text not null default 'general',
  message text not null,
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_beta_feedback_created_idx
  on public.platform_beta_feedback (created_at desc);

alter table public.platform_beta_feedback enable row level security;

drop policy if exists "beta feedback service only" on public.platform_beta_feedback;
create policy "beta feedback service only" on public.platform_beta_feedback
for all using (false) with check (false);

notify pgrst, 'reload schema';
