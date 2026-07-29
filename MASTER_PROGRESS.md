# Florisyn — Master Progress (Closed Beta)

Single source of truth for roadmap execution. Updated after each completed bundle.

**Last updated:** 2026-07-29 (A1 production deploy executed)  
**Current phase:** 2A — Security / Admin (A1 frozen & deployed; A2 next)

---

## Overall completion

| Scope | % | Notes |
|-------|---|--------|
| Phase 2A (all bundles) | ~17% | Bundle A1 complete; A2–A5 pending |
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

### Remaining Phase 2A work

- **A2** — Auth, JWT, RLS (`currentUser`, staff PIN, `staff_time_entries`, payment scoping)
- **A3** — Payments & public endpoints (payment-link payload, webhooks)
- **A4** — Validation & unified `fail()`
- **A5** — Shop creation column alignment + onboarding path cleanup

---

## Next step

**A1:** Frozen — deploy when ready (see deployment status above).  
**A2:** Implementation plan drafted (JWT-first `currentUser`, `staff_time_entries` RLS, PIN hardening, payment-hub `shop_id` scoping). **Awaiting approval:** `Approved — proceed with A2 implementation` — no code until then.
