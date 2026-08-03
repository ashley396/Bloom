# Migration order (review only — do not apply without approval)

Apply in Supabase SQL editor or CLI **after backup** (or confirmed PITR). Forward-only; use new migration files to fix mistakes.

**Stop immediately on migration failure.** Recovery is **backup / PITR** — do not run destructive `DOWN` scripts in production.

Keep `FLORISYN_FLAG_COMMUNITY_BETA` missing or `false` until all approved migration applies and persona/RLS verification pass.

This document does **not** claim that any hosted staging or production migration from PR #13 has already run.

## Historical / core order (preserve)

1. Base SaaS / core tables (legacy foundation migrations if greenfield)
2. `20260727_marketplace_verification_production_v1.sql`
3. `20260728_marketplace_milestone_v2.sql`
4. `20260728_wholesale_seller_v1.sql`
5. `20260728_command_center_v1.sql`
6. `20260728_lily_ai_platform_v1.sql` (optional server-side Lily history)

## PR #13 migration set (`beta/august10-stabilization`)

Apply only after Technical Director approval and backup/PITR confirmation.

7. `20260731_florist_community_beta_v1.sql`
   Locked Community tables + private `florist-community` bucket. RLS on; no authenticated/anon Community access until R1.
8. `20260731_florist_community_beta_v1_r1_security.sql`
   Community security unlock (policies, RPCs, grants). **Must follow Community v1.** If R1 fails after v1, Community remains locked — fix and re-apply R1 (idempotent); do not continue the release.
9. `20260801_p0_01_floral_library_schema_lock_v1.sql`
   Floral Library RLS lock (P0-01 / R1). **Independent** from Community migrations (no Community table/helper dependency). Included because of repository **filename chronology** after the Community pair. Enables RLS and restricts Floral Library master / import-batch exposure. Verify ordinary florist, inactive admin, non-super-admin, `super_admin`, and `service_role` personas after apply.

### Excluded / paused

- `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` — **Staff A2 remains paused** and is **excluded** from this PR #13 apply set.

### Apply rules for PR #13

- Take a backup or confirm PITR **before** applying anything.
- Community **v1 must precede** Community R1.
- Floral Library lock is independent of Community but is ordered after the Community pair by filename chronology.
- Stop immediately on any migration failure; do not continue past an error.
- Keep the Community feature flag **OFF** until all migration and persona tests pass.
- Do **not** claim hosted apply success until an approved environment actually records it.

## Rollback guidance

- Supabase: restore from **point-in-time recovery** or nightly backup — do not run destructive `DOWN` scripts in production.
- Netlify: redeploy previous successful deploy from deploy history.
- Secrets: rotate keys if service role was exposed.
- Product kill switch (does not undo schema): set `FLORISYN_FLAG_COMMUNITY_BETA=false` or remove the variable.

## Pre-apply checklist

- [ ] Backup taken (see BACKUP-RECOVERY.md) or PITR confirmed
- [ ] Migration reviewed in PR #13
- [ ] Community flag OFF for verification window
- [ ] Staging apply succeeded (when TD-approved)
- [ ] Community RLS / two-shop checks verified when Community migrations are applied
- [ ] Floral Library persona/RLS checks verified when floral lock is applied
- [ ] Staff A2 left paused / excluded
