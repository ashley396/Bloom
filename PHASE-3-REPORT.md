# Phase 3 Report — August 10 Beta Stabilization (+ Correction R1)

**Branch:** `beta/august10-stabilization`  
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`  
**Starting commit (stabilization):** `eb690be`  
**Reviewed PR tip (pre-R1):** `c63855e`  
**Correction R1 tip:** see latest commit on branch after R1 push  

**Draft PR:** https://github.com/ashley396/Bloom/pull/13 — **NOT MERGED**

## Truth (Correction R1)

- Community feature flag **defaults OFF**.
- Community images are **private**; API returns **300s signed URLs** only.
- **Active florist membership** required (RLS + Netlify).
- Database-backed RLS integration tests were run locally (Postgres 16).
- Migrations **not** applied to staging or production.
- **Staff A2 remains paused**.
- No production deployment.
- PR #12 untouched; Today page untouched; React migration not started.

---

## Commits (functional)

1. `8c353ac` — Community schema, validation, API (initial)
2. `077204d` — Community UI + flag wiring (initial)
3. `2149fc8` — Tests, smoke, checklist (initial)
4. `8935bee`+ — Phase 3 docs (initial)
5. **Correction R1** — security hardening (membership, private storage, guards, counters, magic bytes, flag default off, RLS integration tests)

---

## Security design (R1)

| Control | Implementation |
|---------|----------------|
| Active membership | `is_active_florist()` / `is_active_member_of(uuid)` + policies + `requireActiveFlorist` |
| Private images | Bucket `public=false`; select for active florists; signed URLs 300s |
| SECURITY DEFINER | Fixed `search_path`; revoke PUBLIC/anon; grant authenticated/service_role as appropriate |
| Immutable fields | BEFORE UPDATE guards on posts/comments/profiles/reports |
| Atomic counters | AFTER INSERT/DELETE/UPDATE triggers on likes/comments |
| Active post validation | RLS + RPCs reject likes/comments/reports on non-active posts |
| Repeated reports | `florist_community_report_post` idempotent RPC |
| Magic bytes | Server-side JPEG/PNG/WebP signature check |
| Feature flag | `COMMUNITY_BETA` default false; nav hidden until production-health says true |

---

## Migrations

| File | Applied to staging/prod? |
|------|--------------------------|
| `20260731_florist_community_beta_v1.sql` | **No** |
| `20260731_florist_community_beta_v1_r1_security.sql` | **No** |
| Staff A2 `20260729_phase2a_a2_...` | **Paused — not part of this work** |

**Local apply:** `npm run db:community-local` — success on Postgres 16.

**Rollback:** restore DB backup; or drop R1 RPCs/triggers/policies then re-apply v1 from backup. Prefer backup restore.

---

## Tests (see Correction R1 report for exact totals)

- Unit: `npm test`
- RLS integration: `npm run test:community-rls` (15/15 locally)
- Smoke: `npm run test:community-smoke`
- Foundation / daily-loop / stacked-release / rc1 / check / frontend:build

---

## Remaining staging work

- Apply Community v1 + R1 on an **approved** staging project only
- Enable `FLORISYN_FLAG_COMMUNITY_BETA=true` on that env only
- Live two-shop + Stripe test + mobile device QA
- Staff A2 remains a separate paused track

---

*End of Phase 3 / Correction R1 documentation.*
