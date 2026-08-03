# August 10 Production Checklist

Use this before any production deploy of `beta/august10-stabilization` (PR #13).
**Do not apply staging or production migrations until Technical Director approval.**

Baseline: `main` @ `eb690be` + Florist Community Beta + Correction R6 + P0-01 Floral Library lock + P0-02/P0-03/P0-07A stabilization work on tip `de683c0258e78df765200641c9bc795eae2c98c8`.

**Truth statements:**
- PR #13 is **not merged**.
- No production deployment occurred from this work.
- Community migrations have **not** been applied to staging or production.
- Floral Library lock migration (`20260801_p0_01_floral_library_schema_lock_v1.sql`) is included in PR #13 and has **not** been applied to a hosted environment.
- `COMMUNITY_BETA` **defaults OFF** (enable only with explicit `FLORISYN_FLAG_COMMUNITY_BETA=true`).
- **Keep Community OFF** during all migration apply and persona/RLS verification.
- Community images are **private**; clients receive **short-lived signed URLs** (300s) only when readable.
- Uploaded images are **fully decoded and re-encoded with sharp exactly once** in validation; upload stores only the prevalidated sanitized buffer (no second sharp pass / no data-URL re-decode).
- Declared size and base64 length are enforced **before** `Buffer.from`; malformed base64 is rejected safely.
- Image lifecycle is **fail-closed**: after ambiguous create/update write errors, reconcile by `image_path` using only real JS arrays as conclusive (`[]` orphan remove; non-empty retain; null/undefined/unexpected retain). Logs use Florisyn-owned categorical codes only. Remove previous only after successful replace; author delete removes image after DB success; moderator soft-remove preserves image for review.
- Active florist shop membership requires exactly `shop_members.status = 'active'` (legacy DBs get a guarded status column). Membership constraint compatibility requires the exact allowlist `{active, invited, suspended, removed}` — incomplete/inverted/broader constraints abort loudly.
- v1 alone is **locked** (no Community access) until the security migration succeeds.
- Moderators cannot rewrite content or hard-delete; status-only RPCs only.
- Storage DELETE is owner-only for user JWT; service_role cleanup remains for audited internal processes.
- **Staff A2 remains paused** — do not apply or bundle with Community or Floral Library lock.
- Live Stripe / device testing still requires an approved environment.
- Migration failure **must stop the release process**. Recovery is **backup / PITR** — not destructive DOWN SQL.

---

## 1. Database backup (do this first)

1. Open Supabase Dashboard → **Database → Backups**.
2. Create a **manual backup** (or confirm PITR is enabled).
3. Record backup time and project ref in your change log.
4. Optional: `pg_dump` a logical backup for extra safety.

**Do not apply any PR #13 migration until backup/PITR is confirmed.**

---

## 2. Supabase migrations still needing apply

Apply **in order** only after approval. Skip any already applied.
Use the repository migration history / approved apply process. **Stop on failure** — do not continue past an error, and do not manually paste an insecure intermediate state.

Keep `FLORISYN_FLAG_COMMUNITY_BETA` missing or `false` for the entire migration and persona verification window.

### Existing stack (verify applied)

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/v4.1.sql` … `v8.0.sql` | Baseline schema |
| `supabase/migrations/20260728_release_candidate_v1.sql` | RC1 / beta feedback |
| `supabase/migrations/20260728_payment_hub_v1.sql` (+ related) | Payment Hub |
| `supabase/migrations/20260728_business_ecosystem_v1.sql` | Business OS tables |
| `supabase/migrations/20260730_foundation_daily_loop_v1.sql` | Foundation + Daily Loop |
| `supabase/migrations/20260730_delivery_proofs_storage.sql` | Delivery proof bucket |

### Required for Community Beta (after approval)

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/20260731_florist_community_beta_v1.sql` | **Locked** Community tables + private bucket (no client access yet) |
| `supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql` | **Security unlock** — active membership, private image auth, narrow moderation RPCs, grants |

Community **v1 must precede** Community R1. If the security migration fails after v1, Community remains locked (not publicly accessible). Fix the failure, then re-apply the security migration (idempotent).

### Required for Floral Library lock (after approval) — included in PR #13

| Migration | Purpose |
|-----------|---------|
| `supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql` | Enables RLS and restricts Floral Library master / import-batch exposure (P0-01 / R1) |

**Floral Library lock facts:**
- Included in PR #13 tip.
- **Independent** from Community migrations (does not depend on Community tables or helpers).
- Follows repository filename chronology after the Community pair.
- Has **not** been applied to a hosted environment.
- Enables RLS and restricts Floral Library access (approved master reads for authenticated; unapproved master visibility for active `super_admin` only; import batches service_role only).
- Requires staging verification for personas: **ordinary florist**, **inactive admin**, **non-super-admin**, **super_admin**, and **service_role**.
- Failure must **stop the release process**.
- Recovery is **backup / PITR** — not destructive DOWN SQL.
- Keep Community **OFF** during Floral Library migration verification.

### Paused (do not apply as part of PR #13)

| Migration | Status |
|-----------|--------|
| `supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | **Staff A2 — PAUSED** (separate track) |

**Apply method (recommended):**

1. Confirm backup / PITR.
2. Confirm Community flag is OFF.
3. Apply `20260731_florist_community_beta_v1.sql` through the approved migration path.
4. Apply `20260731_florist_community_beta_v1_r1_security.sql` next.
5. Confirm no errors; verify bucket `florist-community` has `public = false` and Community policies exist.
6. Apply `20260801_p0_01_floral_library_schema_lock_v1.sql` (independent of Community; filename chronology after Community pair).
7. Run Floral Library persona/RLS verification (ordinary florist, inactive admin, non-super-admin, super_admin, service_role).
8. **Stop immediately** on any migration or persona failure; recover via backup/PITR — do not run destructive DOWN SQL.
9. Do **not** instruct operators to apply insecure intermediate SQL manually.
10. Do **not** enable Community until all migration and persona tests pass and TD approves.

---

## 3. Staff-time RLS A2 — PAUSED

**Do not apply Staff A2 as part of PR #13.**
Staff A2 remains a separate, paused workstream. Do not include it in staging or production Community or Floral Library rollout instructions.

---

## 4. Community database tables, storage, and RLS

Files:
1. `20260731_florist_community_beta_v1.sql` (locked schema)
2. `20260731_florist_community_beta_v1_r1_security.sql` (authorization)

### Tables

- `florist_community_profiles`
- `florist_community_posts`
- `florist_community_comments`
- `florist_community_likes`
- `florist_community_reports`

### Storage

- Bucket: `florist-community`
- Limit: 2 MB encoded **and** after sanitization
- MIME: jpeg, png, webp (declared + detected + sharp format must agree)
- Path: `{shop_id}/{user_id}/{server-generated}.{ext}`
- Server: full decode/re-encode via `sharp@0.35.3`; metadata stripped
- Reads: only when `florist_community_image_readable(path)`
  - active posts → active florists
  - moderated posts → active author, active shop manager, or platform admin
- DELETE (user JWT): active image owner only
- No permanent public object URLs

### Membership rule

A user may use Community as a participant only when authenticated **and** they have at least one `shop_members` row with exactly `status = 'active'`.
Platform administrators may use **moderation-only** access via `is_platform_admin_user()` without becoming ordinary Community participants.

### Local verification (allowed)

```bash
COMMUNITY_APPLY_MODE=v1-alone npm run db:community-local
npm run db:community-local
COMMUNITY_APPLY_MODE=r1-again npm run db:community-local
npm run test:community-rls
```

---

## 4b. Floral Library lock — tables, RLS, and persona verification

File (included in PR #13):
- `supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql`

Targets:
- `public.bloom_floral_library_master`
- `public.bloom_library_import_batches`

Intent:
- Enable RLS and restrict Floral Library access.
- Ordinary authenticated clients: approved master select only; no authenticated writes.
- Unapproved master visibility: active `super_admin` capability helper only.
- Import batches: service_role only (zero JWT policies).

### Staging persona checks (required after approved apply)

| Persona | Expected |
|---------|----------|
| Ordinary florist | Approved master readable per policy; no unapproved/import access; no writes |
| Inactive admin | No elevated Floral Library admin capability |
| Non-super-admin platform role | Denied elevated unapproved master visibility / admin mutations |
| `super_admin` | Elevated unapproved master visibility per lock helper; admin path still Founding Beta gated |
| `service_role` | Import-batch / service processing path retained |

Keep Community **OFF** while performing these checks.

### Local verification (allowed)

```bash
npm run db:floral-library-local
npm run test:floral-library-rls
```

---

## 5. Netlify environment variable names

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | Yes | Client key (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | Yes* | Server only — never in frontend |
| `SITE_URL` | Yes | Production origin |
| `STRIPE_SECRET_KEY` | Yes | Prefer test mode for beta |
| `STRIPE_WEBHOOK_SECRET` | Yes | Matching mode |
| `FLORISYN_FLAG_COMMUNITY_BETA` | **Required for Community** | Must be explicitly `true` to enable; missing/false = OFF |

\* Needed for some admin/store flows and audited cleanup. Community feed uses user JWT + RLS.

**Never** put service-role or Stripe secrets in `public/`.

During migration verification, leave `FLORISYN_FLAG_COMMUNITY_BETA` unset or `false`.

---

## 6. SITE_URL and email redirects

1. Set `SITE_URL` to the production app origin.
2. Supabase Auth URL config: site URL + allowlist for verify-email / reset-password.
3. Confirm Netlify redirects in `netlify.toml`.
4. Test signup verify + password reset on the target environment.

---

## 7. Stripe production configuration

Prefer **Stripe test mode** until go-live approval.
Do not mix live keys with test webhooks (`assertStripeLivemodeMatchesKey`).

Live Stripe / device testing still requires an **approved** environment — not performed by Correction R6.

---

## 8. Mobile testing (approved env)

| Flow | Pass? |
|------|-------|
| Community hidden when flag missing/false | ☐ |
| Community visible when flag explicitly true | ☐ |
| Active florist feed / post / like / comment | ☐ |
| Second shop cross-read; no cross-edit | ☐ |
| Private signed images load for members | ☐ |
| Hidden post images not renewable for ordinary florists | ☐ |
| Core POS (Today / orders / payments) unchanged | ☐ |

---

## 9. Netlify rollback

1. Netlify → **Deploys** → publish last known-good deploy.
2. Prefer Community kill switch before full rollback when possible.

---

## 10. Emergency Community disable

1. Set `FLORISYN_FLAG_COMMUNITY_BETA=false` (or remove the variable).
2. Redeploy.
3. Backend returns 503; nav stays hidden.

---

## 11. Post-apply smoke (two shops) — after approved migration apply

1. Shop A active member: profile → post (+ sanitized image) → like/comment.
2. Shop B active member: sees feed; cannot edit/delete A’s post; can like/comment/report.
3. Inactive/suspended member: denied (including image renewal).
4. Confirm signed image URLs expire (~300s) and bucket is private.
5. Confirm orders/customers never appear in Community responses.

Perform only after Community migrations succeed, Floral Library persona checks pass (if floral lock was applied in the same window), and TD approves enabling the Community flag.

---

## Sign-off

| Check | Owner | Date |
|-------|-------|------|
| Backup created / PITR confirmed | | |
| Community v1 then security migration applied (approved env only) | | |
| Floral Library migration applied | | |
| Floral Library persona/RLS verification passed | | |
| Staff A2 left paused | | |
| `FLORISYN_FLAG_COMMUNITY_BETA` explicit decision (remain OFF until all migration + persona tests pass) | | |
| Mobile / two-shop smoke | | |
| TD authorization to proceed | | |
