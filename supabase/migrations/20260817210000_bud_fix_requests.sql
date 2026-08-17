-- Bud's Fix Queue: where a "Request Claude Code fix" click in the Admin
-- Command Center now actually lands, via
-- netlify/functions/claude-code-fix-intake.js — the receiving end of
-- CLAUDE_CODE_FIX_WEBHOOK_URL, which previously pointed nowhere.
--
-- Same access model as platform_support_items: row level security is on
-- with no client policies at all. Nothing reads or writes this table
-- except the service-role client, gated in application code by either a
-- verified platform admin (Command Center) or the shared webhook token
-- (the intake function) — never a florist's own session.
create table if not exists public.platform_agent_fix_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.platform_support_items(id) on delete set null,
  item_type text,
  subject text not null,
  body text,
  shop_id uuid references public.shops(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  recent_shop_errors jsonb,
  policy_doc text,
  policy_summary text,
  status text not null default 'queued' check (
    status in ('queued', 'investigating', 'diff_ready', 'awaiting_approval', 'shipped', 'dismissed')
  ),
  assignee_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_agent_fix_requests_status_idx
  on public.platform_agent_fix_requests (status, created_at desc);

alter table public.platform_agent_fix_requests enable row level security;
-- No client policies — service-role only, same as platform_support_items.
