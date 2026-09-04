-- Premium AI Creative — database-enforced job/reservation idempotency
-- (Hybrid Marketing Studio Batch 4.1, "close the premium job idempotency
-- race").
--
-- PROVEN RACE (schema inspection, staging): ai_execution_jobs had no
-- unique constraint of any kind beyond its own `id` primary key —
-- findActivePremiumJobForContentItem() -> createPremiumJob() was a
-- plain check-then-insert with a real TOCTOU window: two concurrent
-- requests for the SAME content item could both observe "no active job"
-- and both successfully insert their own job row, each with its own
-- OpenAI usage reservation. The later atomic planned->running worker
-- claim only prevents a single job from being executed twice; it does
-- nothing to stop two jobs from being CREATED in the first place.
--
-- FIX: a deterministic idempotency key for "one logical Premium
-- generation attempt for one content item," enforced by the database
-- itself (a partial unique index — the only way application code alone
-- can guarantee this under real concurrency), on BOTH of the two tables
-- that must never duplicate for the same attempt:
--
--   ai_execution_jobs.idempotency_key (NEW column, text)
--     = 'premium_creative:<content_item_id>:<attempt_index>' verbatim
--       (built by marketing-premium-creative-job.js's
--       buildPremiumIdempotencyKey()). Enforces "at most one Premium
--       job for this content item's attempt N, ever" — the authoritative
--       gate against creating a second JOB row.
--
--   marketing_generation_usage.operation_id (EXISTING column, uuid,
--   added by 20260901000000_marketing_generation_usage_ledger_extension.sql
--   with a non-unique partial index)
--     = a deterministic RFC4122 v5 UUID derived from that SAME literal
--       string (marketing-premium-creative-job.js's
--       buildPremiumOperationId()), since this column is uuid-typed and
--       cannot hold the literal string directly. Enforces "at most one
--       OpenAI usage RESERVATION for this content item's attempt N,
--       ever" — a second, independent gate at the money-significant
--       boundary, kept even though the job-level gate above should
--       already prevent a second attempt from ever reaching this insert
--       in practice (defense in depth against any future code path that
--       reserves usage without going through the job-creation gate
--       first).
--
-- SAFETY OF REUSING operation_id (audited before writing this
-- migration): grep across every netlify/functions/_shared/*.js and
-- netlify/functions/*.js call site shows `operationId` is plumbed
-- through reserveProviderCall()'s own parameter list but is NEVER set to
-- a non-null value by any existing caller anywhere in this codebase
-- today — every real marketing_generation_usage row that exists has
-- operation_id = NULL. A partial unique index scoped to
-- `operation_id IS NOT NULL` therefore applies to zero existing rows and
-- can never conflict with any other provider/operation's future use of
-- this column, UNLESS this migration further narrows it — which it does
-- (scoped to provider='openai' AND operation='premium_creative_image'
-- specifically) per Ashley's own instruction to prefer the narrowest
-- partial unique index possible rather than a bare global one, so any
-- future feature remains completely free to use operation_id however it
-- wants for any other provider/operation without ever touching this
-- constraint. No existing constraint is weakened or removed.
--
-- Purely additive: idempotency_key is a nullable new column (existing
-- rows read NULL, matching every other job that predates this
-- migration and is therefore automatically excluded from the unique
-- index's own partial predicate); operation_id already exists and its
-- prior non-unique index is untouched (this adds a second, NARROWER
-- index alongside it — the existing marketing_generation_usage_
-- operation_idx keeps serving every other operation's lookups).

alter table public.ai_execution_jobs
  add column if not exists idempotency_key text;

comment on column public.ai_execution_jobs.idempotency_key is
  'Deterministic identity for one logical multi-step AI job attempt (e.g. "premium_creative:<content_item_id>:<attempt_index>" for a Premium Creative image job) — NULL for every job type that does not need create-or-get idempotency. A partial unique index on this column is the authoritative database-level guard against two concurrent requests both creating a job for the same logical attempt.';

create unique index if not exists ai_execution_jobs_idempotency_key_uidx
  on public.ai_execution_jobs (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists marketing_generation_usage_premium_operation_uidx
  on public.marketing_generation_usage (operation_id)
  where operation_id is not null
    and provider = 'openai'
    and operation = 'premium_creative_image';
