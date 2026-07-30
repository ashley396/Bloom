# Florisyn Foundation v1 — Changelog

**Date:** 2026-07-30  
**Branch:** `build/florisyn-foundation-v1`  
**Backup:** `backup/florisyn-pre-foundation-20260730-1415` @ `3fd33de`

---

## Overview

Phase 0 repository audit and Phase 1 foundation batch: daily operating loop schema additions, honest AI status, feature flags, order status history wiring, production health enrichment, React error boundary, foundation tests, and eight architecture documents — **without redesigning the approved Today page or breaking existing production behavior**.

---

## Files changed

### New files

| Path | Purpose |
|------|---------|
| `supabase/migrations/20260730_foundation_daily_loop_v1.sql` | Additive migration: statuses, history, delivery proof, customer/inventory columns, audit_events |
| `netlify/functions/_shared/feature-flags.js` | Central feature flag defaults + env overrides |
| `netlify/functions/_shared/ai-status.js` | Honest Lily/Rose availability logic |
| `netlify/functions/_shared/order-status.js` | Status vocabulary + history recorder |
| `netlify/functions/ai-status.js` | Public GET endpoint for AI configuration state |
| `frontend/src/components/ErrorBoundary.tsx` | React global error boundary |
| `tests/foundation-v1.test.js` | Foundation unit tests (6 cases) |
| `tests/foundation-release-security.test.js` | Pre-production security/release tests (35 cases) |
| `docs/FLORISYN_REPOSITORY_AUDIT.md` | Full repository audit |
| `docs/FLORISYN_MASTER_BUILD_CHECKLIST.md` | Master build checklist by product area |
| `docs/SECURITY_REVIEW.md` | Security findings + fixes |
| `docs/RELIABILITY_AND_RECOVERY.md` | Error handling, backup, rollback |
| `docs/SEO_FOUNDATION.md` | SEO architecture |
| `docs/LEGAL_COMPLIANCE_ARCHITECTURE.md` | Legal acceptance architecture |
| `docs/COST_CONTROL_PLAN.md` | Infrastructure cost controls |
| `docs/FOUNDATION_QA_REPORT.md` | QA gate results |
| `netlify/functions/_shared/site-url.js` | Auth redirect sanitization + diagnostics |
| `netlify/functions/_shared/stripe-mode.js` | Stripe live/test mode validation |
| `netlify/functions/_shared/upload-validation.js` | Delivery proof upload validation |
| `supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql` | Emergency rollback (manual) |
| `docs/FOUNDATION_RELEASE_REVIEW.md` | Independent pre-production verification |
| `docs/FOUNDATION_PRODUCTION_RUNBOOK.md` | Step-by-step production process |

### Modified files

| Path | Change |
|------|--------|
| `netlify/functions/orders.js` | Import normalizeOrderStatus; record status history on create/patch |
| `netlify/functions/production-health.js` | Include AI status + feature flags in health JSON |
| `public/app.js` | `refreshAiStatus()` prefers `/.netlify/functions/ai-status` for honest cloud status |
| `frontend/src/App.tsx` | Wrap routes in `ErrorBoundary` |
| `package.json` | Add `test` and `test:foundation` scripts |

### Preserved (not modified)

- Approved Today page layout and styling
- Floral Asset Library frozen architecture (`frontend/src/lib/floral-asset-library/`)
- Production `public/index.html` structure (no redesign)
- Stripe integration core (`create-checkout.js`, webhooks)
- Staff PIN privacy server logic (`staff.js`)
- Netlify publish path (`public/` — React preview not promoted)

---

## Migrations added

**`20260730_foundation_daily_loop_v1.sql`**

- Expands `orders.status` check constraint (legacy values kept)
- Creates `order_status_history` with RLS
- Adds delivery proof columns: `proof_photo_url`, `signature_name`, `proof_captured_at`, `round_trip_origin`, `round_trip_returned_at`
- Adds customer columns: `deleted_at`, `contact_preferences`, `is_house_account`
- Adds inventory columns: `received_at`, `use_by`, `color`, `markup_multiplier`, `item_kind`
- Creates `audit_events` with RLS (if not present)

**Apply after backup** — see `docs/production/MIGRATION-ORDER.md`.

---

## Environment variables

### Required for full functionality (unchanged)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Database |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin client |
| `SUPABASE_ANON_KEY` | Client auth |
| `SITE_URL` | Production URLs in verification emails |
| `STRIPE_SECRET_KEY` | Card payments |
| `STRIPE_WEBHOOK_SECRET` | Webhook verification |

### Optional / new behavior

| Variable | Purpose |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | AI Online state |
| `OPENAI_API_KEY` | AI Limited fallback |
| `OLLAMA_URL` / `BLOOM_AI_HOST` | Remote Ollama (Limited) |
| `FLORISYN_FLAG_<NAME>` | Override feature flags (e.g. `FLORISYN_FLAG_VOICE_WAKE=false`) |
| `GOOGLE_MAPS_API_KEY` | Delivery round-trip routing |

---

## Features completed (this batch)

- ✅ Repository audit document with PRESERVE/COMPLETE/FOUNDATION/ARCHITECT/FUTURE classification
- ✅ Master build checklist across all product areas
- ✅ Honest AI status API + Settings UI integration (no fake "online")
- ✅ Feature flag module with safe defaults (voice wake off, inventory AI off)
- ✅ Order status normalization (`NEW` → `PENDING`) + history insert on server
- ✅ Production health endpoint enriched with AI + flags
- ✅ React ErrorBoundary for preview app
- ✅ Foundation test suite (6 tests)
- ✅ Security, reliability, SEO, legal, cost architecture documents
- ✅ QA report with honest 321/322 test result

## Features partially completed (schema/server; UI follow-up)

- 🟡 Order status history — server writes; UI timeline not added
- 🟡 Delivery proof-of-delivery — DB columns only
- 🟡 Customer soft-delete / house account — columns only
- 🟡 Inventory color/markup/freshness — columns only
- 🟡 Audit events table — created; not wired to all mutations

## Bugs fixed

- Lily/Rose appearing "offline" without explanation → Settings now shows Configuration Required with clear message when no AI provider configured
- Auth verification links could use localhost → `site-url.js` sanitizes pathnames; `SITE_URL`/`DEPLOY_PRIME_URL` preferred (requires env in prod)
- Feature flag env overrides ignored passed env object → fixed in `_shared/feature-flags.js`
- Stripe webhook livemode/key mismatch could process wrong-mode events → `assertStripeLivemodeMatchesKey` in `stripe-order-webhook.js`
- Stale sidebar test expected `Payments` instead of approved `Payment Center` label → test updated

---

## Feature-flagged (off by default)

| Flag | Default | Module |
|------|---------|--------|
| `VOICE_WAKE` | false | Voice wake words |
| `VOICE_TTS_CLOUD` | false | Cloud TTS |
| `INVENTORY_AI_INTAKE` | false | AI inventory from photos |
| `INVENTORY_RECIPE_DEDUCTIONS` | false | Silent recipe deductions |

---

## Risks remaining

1. Migration not applied in production — status history inserts warn-and-continue until table exists
2. Pre-existing RC2.2 sidebar test failure (1/322)
3. Client session refresh still unwired
4. JWT in localStorage (XSS surface)
5. React preview not connected to production API

---

## Manual test instructions

See `docs/FOUNDATION_QA_REPORT.md` — Manual test script section.

Quick smoke:

```bash
npm run test:foundation
node scripts/check.mjs
cd frontend && npm run build
```

---

## Rollback steps

1. **Netlify:** Publish previous deploy or branch `backup/florisyn-pre-foundation-20260730-1415`
2. **Database:** Restore Supabase backup from before migration apply
3. **Git:** `git checkout backup/florisyn-pre-foundation-20260730-1415`

Code rollback alone is safe without migration apply. If migration was applied, prefer DB restore over destructive down migrations.

---

## Deployment steps (owner — single controlled release)

**Do not deploy until review complete.**

```bash
# 1. Merge or deploy branch build/florisyn-foundation-v1
# 2. Backup Supabase (dashboard → Database → Backups)
# 3. Apply migration 20260730_foundation_daily_loop_v1.sql
# 4. Verify Netlify env: SITE_URL, Supabase, Stripe (test mode confirmed)
# 5. Trigger ONE Netlify production deploy from approved commit
# 6. Run manual smoke tests from FOUNDATION_QA_REPORT.md
# 7. Monitor production-health and function logs for 24h
```

**Safe deploy trigger:** See `docs/FOUNDATION_PRODUCTION_RUNBOOK.md` — prefer Netlify Dashboard branch deploy; `netlify deploy --prod --branch=...` is not valid CLI syntax.

```bash
# After owner approval — from checked-out branch:
netlify deploy --prod
```

Only run after owner approval and staging verification.

---

## Route list (unchanged production)

Primary florist app routes remain hash/page-based in `public/index.html`:

- Today / Dashboard (`dashboardPage`)
- Orders, Customers, Deliveries, Inventory, Products
- Invoices, Payments (Payment Center)
- Staff, Reports, Settings, Library, Website
- Marketplace, Wholesale, Subscription, Ecosystem (feature-gated modules)

New API route:

- `GET /.netlify/functions/ai-status` — public AI configuration status

---

*Foundation v1 — build beautiful, simple, secure, reliable, honest.*
