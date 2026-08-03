# Staging Bootstrap Plan — Brand-New Supabase Project

**Purpose:** Ordered, rehearseable plan to stand up a **new** Florisyn staging Supabase database through PR #13 tip schema readiness.  
**Local rehearsal HEAD baseline:** `bf1943163444f86293c633219c0d0ac019ca1a00` (+ this plan).  
**Hard stop:** Do **not** connect to or mutate hosted staging until Technical Director approval after local rehearsal passes.

## Truth / constraints

- Community remains **OFF** (`FLORISYN_FLAG_COMMUNITY_BETA` missing/false) during bootstrap and persona verification.
- Staff A2 migration is **paused / excluded**.
- Rollback SQL is **excluded** (use backup/PITR only).
- `supabase/schema.sql` is **excluded** (conflicts with foundation `shops.owner_user_id` shape).
- Local stub SQL is **local PostgreSQL only** — never apply to hosted Supabase.
- Greenfield bridge SQL files are required for empty projects starting from foundation; they are not substitutes for restoring a production dump.

## Tools

| Tool | Command |
|------|---------|
| Local rehearsal | `STAGING_BOOTSTRAP_DATABASE_URL=... STAGING_BOOTSTRAP_RESET=1 npm run db:staging-bootstrap-rehearse` |
| API key static audit | `npm run audit:staging-api-keys` (never prints secret values) |
| Community RLS (after schema) | `npm run test:community-rls` (separate local URL) |
| Floral RLS (after schema) | `npm run test:floral-library-rls` |

---

## Phase 0 — Create hosted staging project (manual, TD-gated)

1. In Supabase dashboard: **New project** (separate from production).
2. Record (offline change log): project name, ref, region, created-at.
3. Confirm PITR/backups enabled for the project.
4. Copy metadata only (do not paste secrets into git):
   - Project URL → candidate `SUPABASE_URL`
   - anon / publishable key → `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
   - service_role / secret → `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
5. Run `npm run audit:staging-api-keys` in a shell that has those env vars loaded **locally** (values never logged by the script).
6. **STOP** before applying SQL on hosted until local rehearsal is green and TD approves.

---

## Phase 1 — Local rehearsal (required before hosted apply)

### 1A. Provision clean local PostgreSQL

```bash
# Example (already used in rehearsal):
# database florisyn_staging_bootstrap_rehearse on 127.0.0.1
export STAGING_BOOTSTRAP_DATABASE_URL='postgres://florisyn_stage_rehearse:florisyn_stage_rehearse@127.0.0.1:5432/florisyn_staging_bootstrap_rehearse'
export STAGING_BOOTSTRAP_RESET=1
npm run db:staging-bootstrap-rehearse
```

The rehearse script:

1. Refuses non-local hosts / `*.supabase.co`.
2. Optionally resets `public` / `auth` / `storage`.
3. Applies the ordered file list below; **stops on first failure**.
4. Verifies required relations, functions, private `florist-community` bucket, and RLS flags.

### 1B. Exact apply order

#### Local-only (rehearsal)

0. `scripts/sql/local-supabase-compat-stub.sql` — auth/storage/role stubs (**local only**)

#### Hosted + local (greenfield)

1. `supabase/migration_floravia_saas_foundation_v1.sql`
2. `scripts/sql/greenfield-core-pos-bridge.sql` — customers/orders/inventory/expenses + `is_shop_member`
3. `scripts/sql/greenfield-shop-members-status-align.sql` — widen status allowlist for Community R1
4. `supabase/migrations/v4.1.sql`
5. `supabase/migrations/v4.2.sql`
6. `supabase/migrations/v6.0.sql`
7. `supabase/migrations/v7.0.sql`
8. `supabase/migrations/v8.0.sql`
9. `supabase/migration_v8.5.2_delivery_tracking.sql`
10. `supabase/migration_v9.0_integrated.sql`
11. `supabase/migration_v9.0.1_settings_delivery_fee.sql`
12. `supabase/migration_v9.0.2_receipts.sql`
13. `supabase/migration_v9.0.3_settings_schema.sql`
14. `supabase/migration_v9.0.5_delivery_address.sql`
15. `supabase/migration_v9.1_integrated_workflow.sql`
16. `supabase/migration_v10.1_inventory_pro.sql`
17. `supabase/migration_v11.3_branding.sql`
18. `supabase/migration_v12.0_luxury_branding.sql`
19. `supabase/migration_v13.6_staff_timeclock_payroll.sql`
20. `supabase/migration_v16_profit_intelligence.sql`
21. `supabase/migration_v18.5_payment_integrity_security.sql`
22. `supabase/migration_v19.1_order_status_hotfix.sql`
23. `supabase/migration_v20.5_admin_control_center.sql` — creates `platform_admins`
24. `supabase/migration_v20.6_subscriber_intelligence.sql`
25. `supabase/migration_v21_platform_edition.sql`
26. `supabase/migration_v22.1_growth_foundation.sql`
27. `supabase/migrations/20260727_marketplace_verification_production_v1.sql`
28. `supabase/migrations/20260727_marketplace_security_hardening_v1.sql`
29. `supabase/migrations/20260728_marketplace_milestone_v2.sql`
30. `supabase/migrations/20260728_wholesale_seller_v1.sql`
31. `supabase/migrations/20260728_command_center_v1.sql`
32. `supabase/migrations/20260728_lily_ai_platform_v1.sql`
33. `supabase/migrations/20260728_release_candidate_v1.sql`
34. `supabase/migrations/20260728_business_ecosystem_v1.sql`
35. `supabase/migrations/20260728_subscription_center_v1.sql`
36. `supabase/migrations/20260728_payment_hub_v1.sql`
37. `supabase/migrations/20260729_post_order_payment_v185.sql`
38. `supabase/migrations/20260728_payment_hub_pro_v1.sql`
39. `supabase/migrations/20260728_payment_experience_v1_2.sql`
40. `supabase/migrations/20260728_payments_live_wiring_v1_3.sql`
41. `supabase/migrations/20260728_bloom_rc1_instant_websites.sql` — creates Floral Library tables
42. `supabase/migrations/20260728_bloom_rc1_1_storefront.sql`
43. `supabase/migrations/20260728_bloom_rc1_2_commerce.sql`
44. `supabase/migrations/20260730_foundation_daily_loop_v1.sql`
45. `supabase/migrations/20260730_delivery_proofs_storage.sql`
46. `supabase/migrations/20260731_florist_community_beta_v1.sql`
47. `supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql`
48. `supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql`

### Excluded

| File | Reason |
|------|--------|
| `supabase/schema.sql` | Conflicts with foundation shops shape |
| `supabase/migrations/marketplace_verification_schema.sql` | Superseded |
| `supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | Staff A2 paused |
| `supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql` | Rollback only |
| `scripts/sql/local-supabase-compat-stub.sql` on **hosted** | Hosted already has auth/storage |

### Failure behavior

- Stop immediately; do not continue the chain.
- Recovery: drop/recreate local DB (rehearsal) or hosted backup/PITR (staging) — **no DOWN scripts**.

---

## Phase 2 — Staging API key compatibility (static)

Florisyn Netlify code (`netlify/functions/_shared/supabase.js`) accepts:

| Purpose | Accepted env names |
|---------|-------------------|
| Project URL | `SUPABASE_URL` |
| Browser/JWT client | `SUPABASE_ANON_KEY` **or** `SUPABASE_PUBLISHABLE_KEY` |
| Service role | `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY` |

Audit checks (no secret printing):

- URL present / parseable / https for hosted hosts
- Client + server keys present under accepted aliases
- JWT-shaped keys expose distinct `role` claims (`anon` vs `service_role`)
- Keys are not role-swapped
- `FLORISYN_FLAG_COMMUNITY_BETA` is not `true` during bootstrap

**Isolation requirement (from P0-09A):** deploy-preview / staging Netlify contexts must use the **new staging project** keys — not production. Prove scoping in Netlify UI before any preview invoke.

---

## Phase 3 — Hosted apply (TD approval required — not performed by this rehearsal)

Only after Phase 1 green + Phase 2 key audit for the **staging** project:

1. Confirm Community flag OFF on the target Netlify context.
2. Apply steps **1–48** from Phase 1B in the Supabase SQL editor **excluding** local stub (step 0).
3. Stop on failure; restore PITR/backup if needed.
4. Verify objects (same checks as rehearse script).
5. Run persona checks (Floral Library + Community two-shop) with Community still OFF until approved.
6. Only then consider enabling Community on the staging/preview context.

---

## Phase 4 — Explicit STOP

This plan and the local rehearsal **stop before**:

- Connecting application traffic to hosted staging
- Applying SQL on hosted staging
- Changing Netlify env vars
- Enabling Community
- Merging / production deploy
