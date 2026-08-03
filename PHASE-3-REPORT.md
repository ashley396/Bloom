# Phase 3 Report — August 10 Beta Stabilization (PR #13 tip)

**Branch:** `beta/august10-stabilization`
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`
**Starting commit (stabilization):** `eb690be`
**Current PR tip:** `de683c0258e78df765200641c9bc795eae2c98c8`

**Historical Community correction tip pins (unchanged history):**
- Correction R1 tip: `09c9ea78abb45a9220dfb2a3a1824d789df4102d`
- Correction R2 tip: `7880df9e429427b1c6670040ec8ebb8ab0ee5c47`
- Correction R3 tip: `50f313e6b95d65fe9221e957fd1493662a179ea6`
- Correction R3 docs pin / R4 start: `6f34825ccf8a65ba68e7397806edabfb44e891ff`
- Correction R4 tip: `9225b056e95dee06d0aad8495c6fabc733b1d3a7`
- Correction R4 docs tip / R5 start: `d6fb895bfb7f844760294ab7772a0bde61140826`
- Correction R5 tip: `f751d94ece9aa966b125103678e7ad02dd55ce53`
- Correction R5 docs tip / R6 start: `f13e24c66fdad8673472ee4414099ba9775e8a80`
- Correction R6 tip: `b04f7e59ece3e9977b3c834087b29d020ce3136b`

**Draft PR:** https://github.com/ashley396/Bloom/pull/13 — **NOT MERGED**

---

## Current truth (tip `de683c0`)

- PR #13 is **draft / open / unmerged**.
- **No production deployment** from this work.
- **No hosted staging/production migration applied** for Community or Floral Library lock.
- **No hosted database connection** for live schema snapshot work; snapshot SQL was **not** executed against a hosted DB.
- Community feature flag **defaults OFF**; keep OFF until approved migration + persona verification.
- Today page **untouched**.
- **Staff A2 remains paused** and excluded from this apply set.
- Frontend temporary advisory exception **GHSA-qwww-vcr4-c8h2** for `react-router` / `react-router-dom@7.18.2` expires **2026-08-15**.
- Community images are **private**; API returns **300s signed URLs** only after `florist_community_image_readable`.
- Image uploads are **fully decoded and re-encoded with `sharp@0.35.3` exactly once**; upload stores only the prevalidated sanitized buffer.
- Platform-admin Founding Beta: empty/missing allowed roles fail closed to **`super_admin` only**.

---

## Milestone summaries (after Correction R6)

### Community Beta + Corrections R1–R6
Florist Community schema/API/UI with fail-closed membership, private images, single-pass sharp sanitization, fail-closed image reconcile + log allowlist, and Community flag default OFF.

### P0-01 / R1 — Floral Library schema lock
Adds `20260801_p0_01_floral_library_schema_lock_v1.sql`: enables RLS and restricts `bloom_floral_library_master` / `bloom_library_import_batches`. Independent of Community. Not applied to any hosted environment. Local/CI coverage via `npm run test:floral-library-rls`.

### P0-02 R1–R4 — Platform-admin fail-closed boundary
All four platform-admin endpoints require `super_admin`; mutations call `requireSuperAdmin` before writes; branded public error catalog; server-owned request IDs; `Object.hasOwn` catalog lookup; production handlers factory-bound so Netlify context cannot override auth deps.

### P0-03 through R2 — Required PR CI + frontend audit policy
Adds `.github/workflows/p0-required-checks.yml` (Core checks + digest-pinned PostgreSQL 16 dual RLS suites). Temporary frontend audit exception for `GHSA-qwww-vcr4-c8h2` at exact `7.18.2`, expiry **2026-08-15**; R2 applies exception gates only when that advisory is present.

### P0-05 — Branch protection confirmation
GitHub repository ruleset **Florisyn Main Protection** (`rulesets/20192574`, enforcement `active`, target default branch) requires status checks:
- `Core checks`
- `PostgreSQL RLS security suites`
with `strict_required_status_checks_policy: true`. Also enforces pull-request rules, linear history, deletion block, and non-fast-forward. Confirmed via GitHub Rulesets API (not inferred from workflow files alone).

### P0-07A R1–R4 closeout
Safe live schema snapshot pack: READ ONLY metadata SQL, fail-closed static validator, focused tests, runbook. Closeout commit `de683c0258e78df765200641c9bc795eae2c98c8`. No hosted DB connection; snapshot not executed against hosted DB.

### P0-08A — Cumulative scope inventory
Read-only inventory of `main…de683c0` (41 commits / 57 files). Identified missing Floral Library entry in release docs (addressed by P0-08B documentation reconciliation). No code/migration/test changes in 08A.

---

## Commits (functional tracks on this branch)

1. Initial Community Beta work
2. **Correction R1–R6** — membership, private images, sharp single-pass, lifecycle reconcile, log allowlist
3. **P0-01 / R1** — Floral Library schema lock
4. **P0-02 R1–R4** — platform-admin fail-closed boundary
5. Design-system foundation **added then fully reverted** (net zero `frontend/src`)
6. **P0-03 through R2** — required checks workflow + temporary frontend audit policy
7. **P0-07A** — live schema snapshot pack (`de683c0`)

---

## Security design (Community R6 — still current)

| Control | Implementation |
|---------|----------------|
| Single-pass sanitize | `validatePostBody` → sanitized `v.image`; `uploadPrevalidatedCommunityImage` stores buffer only |
| Pre-base64 size | `parseDataUrl` / `maxBase64LengthForBytes` reject before `Buffer.from` |
| Image lifecycle | Fail-closed reconcile: array-only conclusive responses; retain on null/undefined/unexpected shape |
| Log codes | Allowlist only: query_error, query_throw, query_shape, remove_error, remove_throw, unknown |
| Membership constraint | Exact allowlist compare of extracted statuses; reject `NOT IN` / incomplete / extra statuses |
| Image readability | Active posts → active florists; moderated → active author / active manager / platform admin |
| Storage DELETE | Active owner only; no manager/admin direct delete |
| canModerate API truth | Computed via `moderatorForPost` / role+platform-admin; never hardcoded `true` on create |

---

## Migrations / apply process

| File | Applied to staging/prod? |
|------|--------------------------|
| `20260731_florist_community_beta_v1.sql` | **No** |
| `20260731_florist_community_beta_v1_r1_security.sql` | **No** |
| `20260801_p0_01_floral_library_schema_lock_v1.sql` | **No** |
| Staff A2 | **Paused / excluded** |

**Order:** Community v1 → Community R1 → Floral Library lock (independent of Community; filename chronology). Stop on failure. Recovery = backup/PITR, not DOWN SQL. Keep Community OFF during verification.

**Local apply (history-preserving; stops on failure):**
```bash
npm run db:community-local
# COMMUNITY_APPLY_MODE=v1-alone | r1-again
npm run db:floral-library-local
npm run test:community-rls
npm run test:floral-library-rls
```

Do **not** paste insecure intermediate SQL by hand in production.

---

## Current verification truth (at tip `de683c0`)

Recorded at P0-07A closeout on this tip (documentation reconciliation does not re-run the suite):

| Check | Result |
|-------|--------|
| Snapshot tests | **47/47** |
| `npm test` | **576/576** |
| `npm run check` | **229** JavaScript files |
| Frontend build | **pass** |
| Root high audit | **0** |
| Required GitHub workflow | **success** — https://github.com/ashley396/Bloom/actions/runs/30823028506 (`Core checks` + `PostgreSQL RLS security suites`) |

---

## Remaining staging work

- Apply Community v1 then R1 on an **approved** staging project only (after backup/PITR)
- Apply Floral Library lock on that approved env; run persona/RLS verification (ordinary florist, inactive admin, non-super-admin, super_admin, service_role)
- Keep `FLORISYN_FLAG_COMMUNITY_BETA` OFF until all migration + persona tests pass and TD approves enablement
- Live two-shop + Stripe test + mobile device QA
- Staff A2 remains a separate paused track
- Resolve or replace frontend advisory exception before **2026-08-15**

---

*End of Phase 3 report — updated for PR tip `de683c0258e78df765200641c9bc795eae2c98c8` (P0-08B documentation reconciliation).*
