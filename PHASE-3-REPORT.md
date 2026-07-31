# Phase 3 Report — August 10 Beta Stabilization

**Date:** 2026-07-31  
**Branch:** `beta/august10-stabilization`  
**Base:** `main` @ `eb690beb0c138db504cd897ef497a9e54c462a4b`  
**Starting commit:** `eb690be` — Merge PR #11 (Foundation + Daily Loop v3)  
**Ending commit:** tip of `beta/august10-stabilization` (this docs commit)

**Constraints honored:**
- Did not work directly on `main`
- Did not deploy production
- Did not merge PR #12 wholesale
- Did not begin React production migration
- Did not redesign the Today page
- Did not rewrite working core modules
- Did not apply production migrations

---

## Commits in order

1. `8c353ac` — `feat(community): Florist Community Beta schema, validation, and API`
2. `077204d` — `feat(community): Beta UI, nav wiring, and COMMUNITY_BETA flag`
3. `2149fc8` — `test(community): beta coverage, smoke script, and production checklist`
4. *(this commit)* — `docs: Phase 3 August 10 stabilization report`

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260731_florist_community_beta_v1.sql` | Community tables, RLS, storage bucket |
| `netlify/functions/_shared/florist-community.js` | Validation, sanitization, public DTOs |
| `netlify/functions/florist-community.js` | Community API (profiles, feed, posts, likes, comments, reports, moderation) |
| `public/community-ui.js` | Florist Community Beta UI (`BloomCommunity`) |
| `public/community.css` | Mobile-friendly Community styles |
| `tests/florist-community-beta.test.js` | Unit + static security/wiring tests |
| `scripts/august10-community-smoke.mjs` | Local smoke checks (two-shop rules, no secrets) |
| `AUGUST10-PRODUCTION-CHECKLIST.md` | Ops checklist for migrations, env, Stripe, rollback |
| `PHASE-3-REPORT.md` | This report |

## Files changed

| File | Change |
|------|--------|
| `netlify/functions/_shared/feature-flags.js` | Added `COMMUNITY_BETA: true` (disable via `FLORISYN_FLAG_COMMUNITY_BETA=false`) |
| `public/index.html` | Community nav, page shell, CSS + script tags |
| `public/app.js` | `loadCommunityPage`, page map, More-menu + refresh wiring |

---

## Migrations

| Migration | Status in repo | Applied to production? |
|-----------|----------------|------------------------|
| `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` | Already on `main` | **Not applied by this work** — checklist step |
| `20260731_florist_community_beta_v1.sql` | **New** | **Not applied** — checklist step |

### Community schema summary

- `florist_community_profiles` — public florist identity only
- `florist_community_posts` — categories, caption, optional body/image, status
- `florist_community_comments`
- `florist_community_likes`
- `florist_community_reports`
- Helpers: `is_platform_admin_user()`, `is_shop_manager_of(uuid)`

---

## Storage changes

| Bucket | Public | Limit | MIME | Path |
|--------|--------|-------|------|------|
| `florist-community` | Yes (shared feed images) | 2 MB | jpeg, png, webp | `{shop_id}/{user_id}/{timestamp-uuid}.{ext}` |

- Insert: authenticated shop member; folder[2] must equal `auth.uid()`
- Delete: author, platform admin, or shop manager of that shop folder
- No customer/order/employee data stored in this bucket

---

## Security and RLS design

| Rule | Enforcement |
|------|-------------|
| No customer/recipient/employee/payment/order data in Community | API selects only community tables + shop name for default profile; `assertCommunitySafePayload` strips forbidden keys; tests assert no `.from("orders"|"customers"|"staff"|"payments")` |
| Image type/size | Client + server (`validateCommunityImageUpload`); bucket MIME/size limits |
| Edit/delete own posts & comments only | Backend checks `author_user_id === user.id`; RLS `author_user_id = auth.uid()` |
| Admin moderation not UI-only | `moderate_hide` / `moderate_remove` require platform admin **or** shop owner/manager **of the post’s shop**; RLS allows those roles; other shops get 403 |
| Cross-shop feed (intentional) | Authenticated florists can `SELECT` active posts; isolation for **private shop data** remains on orders/customers/etc. |
| Service role never in frontend | Community function uses `currentUser` JWT client; tests scan `public/` for secrets |
| Emergency disable | `FLORISYN_FLAG_COMMUNITY_BETA=false` → API 503 |

**Two-shop model:** Shop A and Shop B both see the Community feed. Shop B cannot edit/delete/hide Shop A posts. Shop A manager can hide Shop A posts. Private POS data never crosses shops (unchanged handlers).

---

## Florist Community Beta — shipped features

- Florist profile (display name, shop name, city/region, bio)
- Community feed with category filters
- Create text post + optional one arrangement image + caption
- Categories: Design Help, Business Advice, Questions, Celebrations
- Encourage (like), comments, report post
- Community guidelines panel
- Basic admin moderation (hide/remove) backend-enforced
- Loading / empty / error states
- Mobile-friendly layout + More menu entry (`community`)

**Not built (as required):** private messaging, live video, groups, payments, Floral Exchange licensing, contests, AI moderation, push notifications.

---

## Tests and results

| Command | Result |
|---------|--------|
| `npm test` | **425/425 pass** (was 410; +15 community tests) |
| `npm run check` | **222 JS files** syntax pass |
| `npm run frontend:build` | **Pass** |
| `npm run test:foundation` | **6/6 pass** |
| `npm run test:daily-loop-v2` | **9/9 pass** |
| `npm run test:daily-loop-v3` | **30/30 pass** |
| `npm run test:stacked-release` | **9/9 pass** |
| `npm run test:rc1` | **5/5 pass** |
| `node scripts/august10-community-smoke.mjs` | **13/13 pass** |

---

## Smoke-test results

### Automated local smoke (`august10-community-smoke.mjs`) — PASS

- Feature flag on/off
- SPA wiring + mobile More menu
- Two-shop authorship (only author edits)
- Moderator shop_id match in API source
- All four categories validate
- Image MIME/size rules
- No secret keys in frontend
- Loading/empty/error UI markers
- Core modules still present (orders, customers, checkout, staff, inventory, website, dashboard)

### Live multi-account / Stripe / device smoke — **NOT RUN in this environment**

No production Supabase/Netlify credentials were used. Remaining live smoke is documented in `AUGUST10-PRODUCTION-CHECKLIST.md` §8 and §11:

| Persona / scenario | Status |
|--------------------|--------|
| Owner/admin account | Pending live staging |
| Normal florist account | Pending live staging |
| Second shop account | Pending live staging (logic covered by unit/smoke) |
| Stripe test mode | Pending live staging (core `create-checkout.js` unchanged) |
| Mobile viewport | CSS + More-menu wired; pending device QA |

---

## Core regression results

Core modules were **not rewritten**. Static presence + full regression suite passed:

| Area | Evidence |
|------|----------|
| Authentication | Unchanged auth pages/functions; suite green |
| Today / dashboard | Unchanged; Today not redesigned |
| Customers | `customers.js` unchanged |
| Orders | `orders.js` unchanged; daily-loop / order-form tests pass |
| Stripe test payments | `create-checkout.js` / stripe-mode unchanged; payment tests pass |
| Receipts / invoices | Unchanged |
| Inventory | Unchanged; daily-loop-v3 pass |
| Staff clock + privacy | A2 migration still in repo; `staff.js` unchanged |
| Website Builder beta | `instant-website.js` / UI unchanged |
| Shop isolation | Existing security tests still pass |

---

## Known issues

1. Community feed requires migration `20260731_florist_community_beta_v1.sql` — until applied, API returns friendly 503.
2. Nav shows Community even when flag disabled (page errors with disable message) — acceptable for emergency kill switch.
3. Like/comment counts use read-modify-write (not RPC atomic) — fine for beta traffic.
4. Live two-shop + Stripe device QA still required before production cutover.
5. Domain purchase in Website Builder remains a stub (pre-existing).
6. Mobile bottom nav still omits Community direct tab (reachable via sidebar / More → `community`).

---

## P0 and P1 blockers

### P0

| ID | Item | Status |
|----|------|--------|
| P0-1 | Florist Community missing | **Resolved in code** (Beta module shipped) |
| P0-2 | Production migrations not applied | **Open — ops** (do not apply until checklist) |
| P0-3 | Production Stripe / SITE_URL confirmation | **Open — ops** |
| P0-4 | Live mobile + two-shop smoke on staging | **Open — QA** |

No uncertain authorization design left in code: own-content edits and shop-scoped moderation are backend + RLS enforced. Treat **unapplied RLS/Community migrations** as the remaining P0 before production.

### P1

| ID | Item |
|----|------|
| P1-1 | Add Community to mobile bottom nav (or richer More sheet) |
| P1-2 | Hide Community nav when flag is false |
| P1-3 | Atomic like/comment counters (DB trigger or RPC) |
| P1-4 | Platform-admin moderation inbox UI (API `moderation` action exists for admins) |

---

## Is August 10 still achievable?

**Yes.** Core florist OS remains intact on the `main` baseline; Florist Community Beta is implemented behind a kill switch; Website Builder precursor remains; production checklist covers migrations, Stripe, rollback, and Community disable.

Remaining path: apply migrations on staging → two-shop live smoke → Netlify preview of this branch → production only after checklist sign-off.

---

## Recommended next task

1. **Staging apply** of `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` + `20260731_florist_community_beta_v1.sql` (not production yet).
2. Run checklist §11 two-shop smoke with real accounts + Stripe test mode.
3. Deploy Preview of `beta/august10-stabilization` for device QA.
4. Only then follow `AUGUST10-PRODUCTION-CHECKLIST.md` for production.

---

*End of Phase 3 report.*
