# Florisyn — Master Progress (Closed Beta)

Single source of truth for roadmap execution. Updated after each completed bundle.

**Last updated:** 2026-07-29 (Bundle A2 implementation complete — awaiting deploy approval)  
**Current phase:** 2A — Security / Admin (A1 frozen & deployed; **A2 ready for review**; A3 next)

---

## Overall completion

| Scope | % | Notes |
|-------|---|--------|
| Phase 2A (all bundles) | ~33% | Bundle A1 complete; **A2 complete (code)**; A3–A5 pending |
| Full Closed Beta roadmap (2A–2G) | ~8% | |

---

## Bundle A1 — Platform bootstrap & admin surface

**Status:** ✅ Complete — **Deployed to production**

### Deployment status

| | |
|--|--|
| **Code / tests / docs** | ✅ Ready |
| **Deploy executed** | ✅ Yes — 2026-07-29 |
| **Production URL** | https://bloom-technologies.netlify.app |
| **Deploy ID** | `6a6a13ce0418d10802dc5bc9` |
| **Build logs** | https://app.netlify.com/projects/bloom-technologies/deploys/6a6a13ce0418d10802dc5bc9 |

### Pre-deploy env confirmation (production context)

| Variable | Status |
|----------|--------|
| `PLATFORM_BOOTSTRAP_SECRET` | ✅ Present (value not logged; non-empty confirmed) |
| `FLORISYN_ALLOW_OPEN_BOOTSTRAP` | ✅ Not set in production (open bootstrap disabled) |

### Post-deploy smoke

| Check | Result |
|-------|--------|
| `GET /.netlify/functions/admin-bootstrap` | `{ "ownerExists": true }` |

### Manual follow-up after deploy

- [ ] `/admin` sign-in as platform owner
- [ ] Confirm POST bootstrap returns **409** (owner already exists)
- [ ] Florist `/` login + one POS path smoke test

### A1 security verification (signed off)

| Check | Status |
|-------|--------|
| Bootstrap permanently locked after first owner | ✓ |
| Setup key validated | ✓ |
| Setup key never logged | ✓ |
| Constant-time comparison confirmed | ✓ |
| Rate limiting active | ✓ |
| Admin role gates verified | ✓ |
| Florist app regression test passed | ✓ |

**Recommendation:** Ready for **Bundle A2** (auth, JWT/RLS, staff, onboarding alignment). A1 code remains **frozen** per stability rule.

### Scope delivered

| ID | Deliverable |
|----|-------------|
| A1.1 | Bootstrap secret + rate limits; **POST permanently disabled** after first `platform_admins` row (409, unchanged message) |
| A1.2 | Minimal Closed Beta RBAC: `requireSuperAdmin()` on high-impact HQ mutations |
| A1.3 | `docs/production/FUNCTION-ACCESS-TIERS.md` + env/security doc updates |

### Permanent bootstrap disable (architecture)

**Compatible with existing architecture.** `admin.js` only needs **GET** `{ ownerExists }` after setup; **POST** is only used when `ownerExists === false`. Once the first owner is inserted, **every POST returns 409** regardless of bootstrap secret—no second owner, no “re-open” via env. GET remains rate-limited for enumeration hardening. No DB migration required.

### Files changed

| File | Why |
|------|-----|
| `netlify/functions/admin-bootstrap.js` | Secret verification, rate limits, structured POST lock after owner exists, safe JSON parse, OPTIONS 204 |
| `netlify/functions/_shared/platform-bootstrap.js` | **New** — `verifyBootstrapSecret`, `bootstrapRateLimit` |
| `netlify/functions/_shared/platform-admin.js` | **New** — `requireSuperAdmin()` |
| `netlify/functions/admin-console.js` | Super-admin gate on shop/subscription/platform settings mutations |
| `netlify/functions/admin-command-center.js` | Super-admin gate on suspend/reactivate, marketplace listing review, announcements, feature flags |
| `netlify/functions/marketplace-verification-admin.js` | Super-admin gate on POST review decisions |
| `public/admin.html` | One-time “Platform setup key” field (founder-only) |
| `public/admin.js` | Send `bootstrapSecret`; clear field after success |
| `tests/platform-bootstrap.test.js` | Secret verification (missing / wrong / config) |
| `tests/platform-admin.test.js` | **New** — `requireSuperAdmin` |
| `docs/production/FUNCTION-ACCESS-TIERS.md` | **New** — access tier catalog |
| `docs/production/ENVIRONMENT.md` | Bootstrap env vars + procedure |
| `docs/production/SECURITY-REVIEW.md` | Bootstrap + super_admin note |
| `docs/production/README.md` | Link to tier doc |

### Database changes

None (additive code/docs only).

### Netlify changes

| Item | Action |
|------|--------|
| `PLATFORM_BOOTSTRAP_SECRET` | **Set before deploy** (required for production first-time setup) |
| `FLORISYN_ALLOW_OPEN_BOOTSTRAP` | Optional; `true` **local dev only** when secret unset |
| Functions | `admin-bootstrap`, `admin-console`, `admin-command-center`, `marketplace-verification-admin` |
| Redirects | None |

### Automated testing

| Command | Result |
|---------|--------|
| `npm run check` | ✅ Pass (308 JS files syntax) |
| `node --test tests/*.test.js` | ✅ **258 passed**, 0 failed, 0 skipped |

### Bootstrap error messages (user-facing)

| Situation | HTTP | Message |
|-----------|------|---------|
| Server not configured for setup | 503 | Platform owner setup is not configured on the server yet… |
| Setup key field empty | 403 | Enter the platform setup key from your Florisyn host. |
| Wrong setup key | 403 | That setup key is not correct. Check the key in Netlify and try again. |
| Owner already exists | 409 | Platform owner setup is already complete. Sign in at Florisyn Administration… |

Body field only: `bootstrapSecret` (no request headers).

### Pre-completion confirmations (code review)

| Requirement | Status |
|-------------|--------|
| Cannot create second owner | ✅ POST returns 409 when `platform_admins` count &gt; 0 (before secret/body processing) |
| Florist JWT cannot use admin routes | ✅ `platformAdmin()` requires `platform_admins` row; shop members get 403 |
| Non–super_admin cannot run gated HQ mutations | ✅ `requireSuperAdmin()` on listed POST actions + unit tests |
| Florist login / POS unchanged | ✅ No changes to `public/app.js`, `login.js`, or florist functions |

### Manual testing checklist (operator — run on staging/prod after deploy)

- [ ] `PLATFORM_BOOTSTRAP_SECRET` set in Netlify
- [ ] GET `/.netlify/functions/admin-bootstrap` → `{ "ownerExists": true|false }`
- [ ] With **no** owner: POST without secret → 403 or 503 (per env)
- [ ] With **no** owner: POST with valid `bootstrapSecret` + valid body → 201
- [ ] With owner: POST → **409** (plain-language “already complete” message)
- [ ] `/admin` first-time form: setup key + owner account → success → login works
- [ ] Florist JWT → `admin-console` → **403**
- [ ] Super admin → overview + shop list → **200**
- [ ] `/` florist login unchanged

### Regression risk

| Area | Level | Mitigation |
|------|-------|------------|
| First HQ setup | Medium | Pre-set secret; use admin.html setup key field |
| Existing super admin | Low | Same capabilities |
| Non–super_admin platform admin (if any) | Low | Only additional 403 on gated POSTs |
| Florist app | None | Untouched |

### Rollback plan

1. Netlify → rollback to previous deploy.  
2. Git revert Bundle A1 commit(s).  
3. No DB rollback. Rotate `PLATFORM_BOOTSTRAP_SECRET` if exposed.

### Known issues

- Rate limits are per Netlify isolate (documented; same as auth-login).
- If `PLATFORM_BOOTSTRAP_SECRET` is missing in production and open bootstrap is false, **first-time POST returns 503** until env is set.

---

## Bundle A2 — Auth, JWT / RLS, staff PIN, payment scoping

**Status:** ✅ **Code complete** — **Not deployed** (awaiting approval)

### Scope delivered

| ID | Deliverable |
|----|-------------|
| A2.1 | **JWT-first `currentUser()`** — member `userClient(token)` only; `usesServiceRole: false`; Tier-3 routes still use explicit `admin()` |
| A2.2 | **`staff_time_entries` RLS** — forward-only migration `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` |
| A2.3 | **Staff PIN hardening** — rate limit PIN actions; list staff without sensitive columns; PIN hash never returned |
| A2.4 | **Payment Hub tenant scoping** — `shop_id` on mutating queries; customers/links scoped; `requireRowShopId` helper |
| A2.5 | **Onboarding auth alignment** — `complete-florist-onboarding` accepts publishable or anon key |
| A2.6 | Docs + tests — `FUNCTION-ACCESS-TIERS.md`, `SECURITY-REVIEW.md`, `tests/platform-a2.test.js` |

### Files changed

| File | Why |
|------|-----|
| `netlify/functions/_shared/supabase.js` | JWT-first `currentUser()` (no service-role bypass) |
| `netlify/functions/_shared/saas.js` | `authenticatedUser()` matches JWT-first pattern |
| `netlify/functions/_shared/shop-scope.js` | **New** — cross-shop row guard |
| `netlify/functions/staff.js` | PIN rate limit; narrow staff SELECT columns |
| `netlify/functions/payment-hub.js` | Shop-scoped updates and customer/link reads |
| `netlify/functions/complete-florist-onboarding.js` | `resolveSupabaseClientKey()` |
| `supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | **New** — RLS on `staff_time_entries` |
| `tests/platform-a2.test.js` | **New** — scope + migration smoke |
| `docs/production/FUNCTION-ACCESS-TIERS.md` | Tier 1 JWT/RLS note |
| `docs/production/SECURITY-REVIEW.md` | Authentication row updated |

### Database changes

| Item | Action |
|------|--------|
| `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | **Apply in Supabase before/ with A2 deploy** — enables RLS + `is_shop_member(shop_id)` policy on `staff_time_entries` |

No other schema changes. **`pin_hash`** column already live (v22.1).

### Netlify environment variables

**No new variables.** Existing required:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` and/or `SUPABASE_PUBLISHABLE_KEY` (florist JWT paths)
- Service role/secret still required only for Tier-0/3 functions (`admin()`, webhooks, public pay links)

### Automated testing

| Command | Result (local) |
|---------|----------------|
| `npm run check` | Run before deploy |
| `node --test tests/*.test.js` | Run before deploy (includes `platform-a2.test.js`) |

### Manual QA checklist (operator)

- [ ] Apply `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` on staging/production Supabase
- [ ] Florist login → dashboard → create/view order (unchanged)
- [ ] Staff list shows names/roles only (`pin_set` boolean, no hash)
- [ ] Employee PIN clock in/out works for manager after RLS migration
- [ ] 12+ wrong PINs within 1 min → **429** on staff PIN actions
- [ ] Payment Hub gift card / house account / saved-method actions still work for active shop
- [ ] `complete-florist-onboarding` works with publishable key env (if anon renamed)
- [ ] HQ / webhooks / `admin-bootstrap` still work (service role paths untouched)

### Regression risk

| Area | Level | Mitigation |
|------|-------|------------|
| Florist routes after JWT-first | Medium | Apply staff_time_entries RLS migration; smoke test staff + orders |
| Shops missing RLS on other tables | Low | Unchanged tables; payment hub still code-scoped by `shop_id` |
| A1 admin bootstrap | None | Not modified |

### Rollback plan

1. Netlify → redeploy previous build (pre-A2).  
2. Git revert A2 commit(s).  
3. SQL: policy can remain (harmless) or `drop policy` + `disable row level security` on `staff_time_entries` only if emergency (not recommended).

### Remaining Phase 2A work

- **A3** — Payments & public endpoints (payment-link payload, webhooks)
- **A4** — Validation & unified `fail()`
- **A5** — Shop creation column alignment + onboarding path cleanup

---

## Next step

**A1:** Frozen — deployed.  
**A2:** **Awaiting approval to deploy** (code + migration script ready).  
**A3:** Not started.
