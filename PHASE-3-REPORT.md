# Phase 3 Report — August 10 Beta Stabilization (+ Correction R2)

**Branch:** `beta/august10-stabilization`  
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`  
**Starting commit (stabilization):** `eb690be`  
**Correction R1 tip:** `09c9ea78abb45a9220dfb2a3a1824d789df4102d`  
**Correction R2 tip:** see latest commit on branch after R2 push  

**Draft PR:** https://github.com/ashley396/Bloom/pull/13 — **NOT MERGED**

## Truth (Correction R2)

- Community feature flag **defaults OFF**.
- Community images are **private**; API returns **300s signed URLs** only after `florist_community_image_readable`.
- **Active florist membership** requires exactly `shop_members.status = 'active'` (no `coalesce`).
- Legacy DBs without `status` are upgraded by a guarded, non-destructive R1 step.
- Broad moderator UPDATE/DELETE policies removed; status-only hardened RPCs only.
- Hidden/removed posts lock out ordinary florists from posts, comments, likes, and image renewal.
- Platform admin authorization uses `is_platform_admin_user()` RPC (never direct `platform_admins` user-client reads).
- `requireActiveFlorist()` is fail-closed (false/errors → deny or 503).
- Report insert is conflict-safe (`ON CONFLICT DO NOTHING`).
- Image validation: magic bytes + MIME match + decode via `image-size` + size limits.
- Database-backed RLS integration tests include legacy schema, apply-twice, real concurrency, and platform-admin persona.
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
5. **Correction R1** — `09c9ea7` membership, private storage, guards, counters, magic bytes, flag default off, RLS tests
6. **Correction R2** — production-schema compatibility, idempotent R1, narrow moderation, hidden lockdown, platform-admin RPC, fail-closed membership, concurrent reports, real concurrency tests, decode image validation, grants hardening

---

## Security design (R2)

| Control | Implementation |
|---------|----------------|
| Legacy `shop_members.status` | Guarded ADD COLUMN + migrate NULL→active; index `shop_members_active_user_idx` |
| Exact active membership | `sm.status = 'active'` only (no coalesce) |
| Narrow moderation | Authors update content on active rows only; managers/admins status via RPC; no hard-delete for moderators |
| Comment/report moderation RPCs | `florist_community_moderate_comment`, `florist_community_moderate_report` |
| Hidden content | Ordinary florists cannot read hidden posts/comments/likes or renew image URLs |
| Platform admin | `is_platform_admin_user()` SECURITY DEFINER; moderation-only exception without shop membership |
| Fail-closed gate | `requireActiveFlorist` throws on false/error; missing helper → 503 |
| Concurrent reports | Atomic upsert conflict path; both callers succeed; status unchanged |
| Image validation | Signatures + MIME + `image-size` decode + encoded/decoded limits; server filenames |
| Function hardening | `florisyn_internal` helpers; empty `search_path`; revoke PUBLIC/anon; minimum table grants; anon revoked |

---

## Migrations

| File | Applied to staging/prod? |
|------|--------------------------|
| `20260731_florist_community_beta_v1.sql` | **No** |
| `20260731_florist_community_beta_v1_r1_security.sql` (R1+R2) | **No** |
| Staff A2 `20260729_phase2a_a2_...` | **Paused — not part of this work** |

**Local apply:** `npm run db:community-local` — success on Postgres 16.  
**Idempotency:** `COMMUNITY_APPLY_MODE=r1-again npm run db:community-local` — success without schema reset.

**Rollback:** restore DB backup; or drop R1 RPCs/triggers/policies then re-apply v1 from backup. Prefer backup restore.

**Supabase security advisor:** not available in this environment’s MCP tool set (no advisor/lint tools exposed). Local privilege assertions cover anon revoke + EXECUTE grants.

---

## Tests (see Correction R2 report for exact totals)

- Unit: `npm test`
- RLS integration: `npm run test:community-rls`
- Smoke: `npm run test:community-smoke`
- Foundation / daily-loop / stacked-release / rc1 / check / frontend:build
- `npm audit --audit-level=high`

---

## Remaining staging work

- Apply Community v1 + R1 on an **approved** staging project only
- Enable `FLORISYN_FLAG_COMMUNITY_BETA=true` on that env only
- Live two-shop + Stripe test + mobile device QA
- Staff A2 remains a separate paused track

---

*End of Phase 3 / Correction R2 documentation.*
