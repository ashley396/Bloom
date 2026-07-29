-- Lily AI Platform v1 (forward-only, idempotent). Review before apply.

create table if not exists public.lily_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lily_conversations_user_shop_idx
  on public.lily_conversations (user_id, shop_id, updated_at desc);

create table if not exists public.lily_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lily_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lily_messages_conversation_idx
  on public.lily_messages (conversation_id, created_at);

create table if not exists public.lily_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  intent text not null,
  action_type text,
  result text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lily_action_audit_shop_idx
  on public.lily_action_audit (shop_id, created_at desc);

alter table public.lily_conversations enable row level security;
alter table public.lily_messages enable row level security;
alter table public.lily_action_audit enable row level security;

drop policy if exists "lily conversations owner" on public.lily_conversations;
create policy "lily conversations owner" on public.lily_conversations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "lily messages owner" on public.lily_messages;
create policy "lily messages owner" on public.lily_messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "lily action audit owner read" on public.lily_action_audit;
create policy "lily action audit owner read" on public.lily_action_audit
for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
