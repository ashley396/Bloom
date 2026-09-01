-- Batch 2 ("Marketing image quality + provider cost accounting"): extends
-- the existing marketing_generation_usage ledger (created in
-- 20260823000000_marketing_studio_foundation_v1.sql) with the fields the
-- new provider-usage service (marketing-provider-usage.js:
-- reserveProviderCall/completeProviderCall/failProviderCall) actually
-- needs to individually account for every real provider call — a text
-- call, an image-generation call, a vision-inspection call, and each of
-- their bounded retries — rather than one row per logical "generation."
--
-- Purely additive: every new column is nullable or has a default that
-- preserves the exact meaning every existing row already has (a row
-- written before this migration has operation/trace_id/operation_id/
-- provider_request_id/model = NULL, attempt_index = 0, cost_source =
-- 'estimated', metadata = '{}') — no existing row's meaning changes, no
-- existing column is dropped or renamed, no data is rewritten. RLS is
-- untouched (the existing "marketing generation usage shop access"
-- policy already covers every column on the table).
--
-- NOT APPLIED to any environment by this migration file's existence —
-- same governing constraint as every other migration in this pass. The
-- application code degrades safely if this hasn't been applied yet:
-- marketing-provider-usage.js's own missing-column handling treats an
-- undefined-column error exactly like a missing table (the same
-- isSchemaMismatchError() convention marketing-budget-guard.js already
-- uses), so nothing breaks before this is applied and nothing needs to
-- change in calling code once it is.

alter table public.marketing_generation_usage
  add column if not exists model text,
  add column if not exists operation text,
  add column if not exists trace_id uuid,
  add column if not exists operation_id uuid,
  add column if not exists attempt_index integer not null default 0,
  add column if not exists provider_request_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.marketing_generation_usage.model is
  'The specific provider model used for this call (e.g. "@cf/black-forest-labs/flux-1-schnell"), when known. NULL for rows written before this column existed.';
comment on column public.marketing_generation_usage.operation is
  'A short, code-defined operation name (e.g. "image_generation", "vision_inspection", "text_generation") distinguishing WHAT this specific provider call did, independent of the coarser `purpose` enum.';
comment on column public.marketing_generation_usage.trace_id is
  'Ties every usage row from one end-to-end request (a single generate_content call, a single compound job) together for observability — matches the same traceId already threaded through this codebase''s structuredLog() calls.';
comment on column public.marketing_generation_usage.operation_id is
  'Groups the individual provider calls that make up ONE bounded operation (e.g. one image-generation-with-vision-inspection attempt, including its retry) — narrower than trace_id, which can span a whole request.';
comment on column public.marketing_generation_usage.attempt_index is
  'Zero-based attempt number within a bounded retry loop (0 = first attempt, 1 = the one allowed corrective retry). Always 0 for a call with no retry concept.';
comment on column public.marketing_generation_usage.provider_request_id is
  'The provider''s own request/response identifier when the provider returns one, for cross-referencing a real provider-side log/invoice line. NULL when the provider doesn''t expose one, or the call failed before a response was returned.';
comment on column public.marketing_generation_usage.metadata is
  'Small structured context for this specific call (e.g. {"error": "..."} on a failed row, or a vision model''s own reported name) — never the customer''s actual generated content. Defaults to an empty object so every existing and new row can always be queried as jsonb.';

-- `status` already distinguishes estimated/actual/failed (the original
-- schema's own reconciliation states); this ADDS a second, orthogonal
-- axis — how confident is the cost figure this row carries right now —
-- without overloading `status` to mean two different things at once. A
-- row stays cost_source = 'estimated' forever if the provider never
-- exposes a real cost figure (Part F's explicit requirement: retain the
-- configured estimate and mark it as such, never silently imply it's
-- provider-confirmed when it isn't).
alter table public.marketing_generation_usage
  add column if not exists cost_source text not null default 'estimated';

alter table public.marketing_generation_usage
  drop constraint if exists marketing_generation_usage_cost_source_check;
alter table public.marketing_generation_usage
  add constraint marketing_generation_usage_cost_source_check
  check (cost_source in ('estimated', 'provider_confirmed'));

comment on column public.marketing_generation_usage.cost_source is
  'Whether actual_cost_cents (when set) came directly from the provider (''provider_confirmed'') or the ledger is still relying on the pre-generation estimate (''estimated''). Never implies a provider-confirmed cost when the provider never actually supplied one.';

-- Widen the purpose enum to recognize a vision-inspection call as its own
-- billable purpose, distinct from the image-generation call it inspects —
-- Batch 2's image quality gate bills these as two separate rows (Part E:
-- "Every actual provider call must create its own usage record").
alter table public.marketing_generation_usage
  drop constraint if exists marketing_generation_usage_purpose_check;
alter table public.marketing_generation_usage
  add constraint marketing_generation_usage_purpose_check
  check (purpose in ('image', 'video', 'avatar_video', 'voice', 'copy', 'vision', 'other'));

create index if not exists marketing_generation_usage_trace_idx
  on public.marketing_generation_usage (trace_id) where trace_id is not null;

create index if not exists marketing_generation_usage_operation_idx
  on public.marketing_generation_usage (operation_id) where operation_id is not null;
