-- Revoked-media hardening — closes the lifecycle gap the Digital Twin
-- integration pass left open: a user can revoke likeness/avatar/voice
-- consent while a generation is already in flight with the provider.
-- Florisyn may still incur the external job/cost, but the resulting
-- media must never become an ordinary usable asset.
--
-- NOT APPLIED to any live Supabase project by this session — committed to
-- the repository only, per the standing rule every prior migration in
-- this repo has followed. Purely additive: every new column is nullable
-- (or has a safe default) and every existing column/constraint/enum
-- value is preserved.

-- ── ai_generated_assets: a real, queryable quarantine state ──────────────
-- Section 3/5 of the directive: audit record and usable asset are kept
-- separate. In practice this migration supports TWO distinct scenarios:
--   1. Consent revoked WHILE a generation is in flight — the finalization
--      code (digital-twin-finalization.js) never inserts a row here at
--      all for that output; the audit trail lives entirely on
--      marketing_clone_video_jobs (below). No row = no reuse surface,
--      structurally, not just filtered.
--   2. Consent revoked AFTER a normal asset already exists, before it's
--      published (Case D) — that row already exists and must be
--      demoted in place. 'quarantined' is the status this migration adds
--      for exactly that case; consent_id makes it queryable directly by
--      revoke_clone_consent rather than string-matching inside content jsonb.
alter table public.ai_generated_assets
  drop constraint if exists ai_generated_assets_status_check;
alter table public.ai_generated_assets
  add constraint ai_generated_assets_status_check check (
    status in ('completed', 'failed', 'quarantined')
  );

alter table public.ai_generated_assets
  add column if not exists consent_id uuid references public.marketing_clone_consent(id) on delete set null,
  add column if not exists quarantine_reason text,
  add column if not exists quarantined_at timestamptz;

create index if not exists ai_generated_assets_consent_idx
  on public.ai_generated_assets (consent_id) where consent_id is not null;

-- ── marketing_clone_video_jobs: the audit trail for in-flight revocation ──
-- 'disposition' is the "final disposition" Section 3 asks the audit
-- record to preserve — distinct from `status` (rendering/completed/
-- failed, the provider's own lifecycle) because a job can genuinely
-- reach 'completed' at the provider and still be quarantined by Florisyn.
-- Null until finalization actually runs; 'normal' or 'quarantined' after.
alter table public.marketing_clone_video_jobs
  add column if not exists disposition text check (
    disposition is null or disposition in ('normal', 'quarantined')
  ),
  add column if not exists quarantine_reason text,
  add column if not exists quarantined_at timestamptz,
  -- The storage path of the ElevenLabs-synthesized audio Florisyn itself
  -- hosts while a HeyGen render is in flight (website-media.js's
  -- uploadClonedVoiceAudio) — tracked so quarantine cleanup can actually
  -- delete it, rather than only being able to delete media it never
  -- recorded a path for.
  add column if not exists temp_audio_path text,
  add column if not exists temp_audio_deleted_at timestamptz;

notify pgrst, 'reload schema';
