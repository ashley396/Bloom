# Florisyn Foundation v1 — QA Report

**Date:** 2026-07-30  
**Branch:** `build/florisyn-foundation-v1`  
**Base commit (pre-work):** `3fd33de41f1c900db3ef535c47dab00f75f415da`  
**Backup branch:** `backup/florisyn-pre-foundation-20260730-1415`

---

## Summary

| Gate | Result | Notes |
|------|--------|-------|
| JS syntax check | ✅ PASS | 210 files — `node scripts/check.mjs` |
| Unit/integration tests | ✅ **357/357 PASS** | Includes 35 release-security tests; RC2.2 sidebar test fixed |
| Foundation tests | ✅ 6/6 PASS | `npm run test:foundation` |
| Frontend TypeScript build | ✅ PASS | `npm run frontend:build` |
| Frontend lint | ✅ PASS | oxlint + floral asset guards |
| npm audit (high+) | ✅ PASS | 0 vulnerabilities |
| Migration SQL review | ✅ PASS | Additive, idempotent patterns |
| Secret scan (manual) | ✅ PASS | No keys in staged files |
| Supabase migration apply | ⛔ NOT RUN | Requires owner credentials |
| Netlify deploy | ⛔ HELD | Per directive — owner-controlled deploy |
| Accessibility audit | ⚪ NOT RUN | No automated a11y runner configured |
| E2E browser tests | ⚪ NOT RUN | No Playwright/Cypress in repo |

---

## Commands executed

```bash
# Repository root
node scripts/check.mjs
node --test tests/*.test.js
node --test tests/foundation-v1.test.js
npm audit --audit-level=high

# Frontend
cd frontend && npm run build && npm run lint
```

---

## Test results detail

### Full suite (`node --test tests/*.test.js`)

```
# tests 357
# pass 357
# fail 0
# duration_ms ~642
```

**Previously failing test (resolved in release review):**

```
sidebar invoices and payments are plain nav buttons without extra wrappers
```

- **Cause:** Test expected nav label `Payments`; approved design uses **`Payment Center`**
- **Fix:** Updated `tests/florisyn-founder-1.0.test.js` — not a product regression

### Foundation v1 tests (`tests/foundation-v1.test.js`)

| Test | Result |
|------|--------|
| normalizeOrderStatus maps NEW → PENDING | ✅ |
| getAiProviderStatus honest without credentials | ✅ |
| getAiProviderStatus online when Cloudflare configured | ✅ |
| feature flags default voice wake off | ✅ |
| auth redirect never uses localhost when SITE_URL set | ✅ |
| sympathy-funeral-spray asset exists | ✅ |

### High-value scenarios — coverage map

| Scenario | Automated | Manual required |
|----------|-----------|-----------------|
| Authentication | ✅ `auth-login` tests | Login flow in browser |
| Tenant isolation | ✅ RLS tests in saas tests | Cross-shop API attempt |
| Order creation | ✅ orders tests | Add order in POS |
| Order editing | ✅ orders PATCH tests | Edit existing order |
| Percentage tax | Partial (order payload tests) | Verify receipt tax line |
| Payment routing | ✅ payment-hub tests | New order → Payment Center |
| Customer editing | ✅ customers tests | CRM edit/save |
| Inventory save | ✅ inventory tests | Add inventory row |
| Staff privacy | ✅ staff tests | PIN gate |
| Verification redirect | ✅ foundation site-url test | Signup email link |
| AI offline fallback | ✅ foundation ai-status test | Settings AI badge |
| Delivery round-trip | Partial route-distance tests | Order with maps key |

---

## Build results

### Frontend (`npm run frontend:build`)

```
✓ built in ~302ms
dist/index.html, CSS ~48KB, JS chunks OK
```

### Lint warnings (non-blocking)

- React fast-refresh warnings in `button.tsx`, `ThemeProvider.tsx`, `page-photo-registry.tsx`, `PhotoAsset.tsx`
- Optional missing asset: `premium-chocolate-gift.jpg` (catalog allows absent)

---

## Migration validation

**File:** `supabase/migrations/20260730_foundation_daily_loop_v1.sql`

| Check | Status |
|-------|--------|
| Uses IF NOT EXISTS / guarded alters | ✅ |
| RLS on new tables | ✅ |
| No DROP TABLE | ✅ |
| Legacy status values preserved | ✅ (NEW still valid; normalized in app) |
| Rollback documented | ✅ `RELIABILITY_AND_RECOVERY.md` |

**Apply command (owner, after backup):**

```bash
supabase db push
# OR paste SQL in Supabase SQL editor after backup
```

---

## Security checks

| Check | Result |
|-------|--------|
| Stripe secret in client code | ✅ Not found in `public/` |
| Service role in frontend | ✅ Not found |
| AI status endpoint leaks secrets | ✅ Returns state only |
| Feature flags expose safe defaults | ✅ VOICE_WAKE false |

---

## What was NOT tested

1. Live Stripe checkout (requires test keys in Netlify env)
2. Live Supabase with migration applied (MCP/auth not available in agent env)
3. Cloudflare AI end-to-end (requires production credentials)
4. Google Maps round-trip (requires `GOOGLE_MAPS_API_KEY`)
5. Email verification link in production inbox (requires `SITE_URL` + SMTP)

---

## Manual test script (post-migration, pre-deploy)

1. Log in to staging/production preview deploy
2. **Orders:** Create order → confirm redirect to Payment Center
3. **Orders:** Change status → verify no error (history row if migration applied)
4. **Settings → AI:** Badge shows honest state (not fake Online)
5. **Staff:** Open staff list — no pay rates visible; open private file requires PIN
6. **Payments:** With Stripe test keys — complete card payment; without keys — clear 503 message
7. **Health:** `curl /.netlify/functions/production-health` returns JSON with `ok: true`
8. **Today page:** Visual unchanged from approved design

---

## Blockers for production deploy

| Blocker | Owner action |
|---------|--------------|
| Migration not applied | Run SQL after Supabase backup |
| SITE_URL for auth emails | Set in Netlify env |
| Stripe mode confirmation | Verify test vs live keys |
| Attorney review of legal text | Before enabling acceptance flow |

---

## Verdict

**Release candidate is ready for owner-controlled production step** — see `docs/FOUNDATION_RELEASE_REVIEW.md` and `docs/FOUNDATION_PRODUCTION_RUNBOOK.md`.

Do not deploy or apply migration until owner completes backup and review.

---

*QA report generated 2026-07-30 — honest results, no falsified success.*
