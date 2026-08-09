-- Bloom RC1.1 — storefront preview tokens & library review (review only, idempotent).

create table if not exists public.bloom_storefront_preview_tokens (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_library_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  batch_id text,
  incoming_hash text not null,
  existing_product_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bloom_preview_tokens_shop_idx on public.bloom_storefront_preview_tokens (shop_id);

alter table public.bloom_storefront_preview_tokens enable row level security;
alter table public.bloom_library_duplicate_reviews enable row level security;

drop policy if exists "preview tokens shop" on public.bloom_storefront_preview_tokens;
create policy "preview tokens shop" on public.bloom_storefront_preview_tokens
for all using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

drop policy if exists "duplicate reviews admin" on public.bloom_library_duplicate_reviews;
create policy "duplicate reviews admin" on public.bloom_library_duplicate_reviews
for all using (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.active));
