# Florisyn Master Architecture & Development Bible

**Last updated:** 2026-07-30  
**Purpose:** Single authoritative index for Florisyn product architecture, integration rules, and permanent specifications.  
**Start here first:** `docs/FLORISYN_GOVERNANCE_MAP.md` — which document to use for each question.  
**Companion docs:** Governance Map, Checklist, Gold Standard, Experience Standard, Design System, Ecosystem Portals, Website Studio blueprint, repository audit, security/reliability/SEO/legal plans.

---

## 0. Governance map — documentation entry point

**Full guide:** `docs/FLORISYN_GOVERNANCE_MAP.md`

| Question | Document |
|----------|----------|
| How should the platform be engineered? | **This bible** |
| What principles override every decision? | `FLORISYN_GOLD_STANDARD.md` |
| How should Florisyn look and feel? | `FLORISYN_EXPERIENCE_STANDARD.md` |
| How should UI components be built? | `FLORISYN_DESIGN_SYSTEM.md` |
| How do the portals fit together? | `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` |
| Who owns each shared service? | `FLORISYN_PORTAL_OWNERSHIP_MATRIX.md` |
| How is Website Studio designed? | `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` |
| What must be complete before release? | `FLORISYN_MASTER_BUILD_CHECKLIST.md` |

**Documentation hierarchy (top → bottom):** Master Architecture Bible → Gold Standard → Experience Standard → Design System → Ecosystem Portals → Website Studio Blueprint → Master Build Checklist.

Together these form the **permanent constitution for Florisyn**. No implementation should contradict a higher-level document.

---

## 1. Product north star

Florisyn is the **operating system for modern florists** — POS, orders, customers, inventory, recipes, deliveries, payments, websites, and AI — with **one shop-scoped source of truth** per tenant.

**Permanent product principles:** `docs/FLORISYN_GOLD_STANDARD.md` — ten owner-approved rules (Single Source of Truth, Florist First, Calm Software, Explainable AI, One Click Rule, Recovery Before Speed, Holiday Mode, Delight, Performance Budget, Future Ecosystem). All modules and agents must comply.

**Permanent UX constitution:** `docs/FLORISYN_EXPERIENCE_STANDARD.md` — visual language, layout, orders presentation, forms, empty states, errors, accessibility, and the seven-question feature completion gate. All screens must harmonize with the approved **Today page** design language.

**Permanent design system:** `docs/FLORISYN_DESIGN_SYSTEM.md` — v1.0 tokens (color, typography, spacing, radius, shadow, motion), component catalog, layout patterns, orders card standard, accessibility, and design review checklist. Single visual source of truth for all portals.

**Permanent portal model:** `docs/FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` — Florist, Wholesaler, and Platform Owner portals on one OS; shared customer, product, inventory, order, payment, delivery, auth, design, notification, and AI services. Every feature must declare portal ownership and shared-service dependencies.

**Portal ownership matrix:** `docs/FLORISYN_PORTAL_OWNERSHIP_MATRIX.md` — which portal owns, manages, or consumes each shared service (Customers through Security). Complements Ecosystem Portals; reinforces Single Source of Truth.

**Non-negotiables:**

- Do **not** redesign the approved **Today page** without explicit owner approval.
- Do **not** duplicate customer, order, product, inventory, delivery, or payment systems for new surfaces (**Gold Standard §1**).
- Server-side secrets stay on Netlify functions; client uses Bearer session tokens.
- Risky or unfinished modules stay **behind feature flags** (default off unless explicitly shipped).
- AI is **honest** about configuration state; Lily proposes, florist approves before publish (**Gold Standard §4**).

---

## 2. System map

```
┌─────────────────────────────────────────────────────────────────┐
│                     Florist production SPA                       │
│  public/app.js + index.html  (Today, POS, Orders, CRM, …)     │
└────────────────────────────┬────────────────────────────────────┘
                             │ Bearer JWT
┌────────────────────────────▼────────────────────────────────────┐
│              Netlify Functions (shop-scoped APIs)                  │
│  orders · customers · inventory · deliveries · payments · …       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│           Supabase Postgres + Auth + Storage (RLS)               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│   Public surfaces: storefront, marketing pages, legal, help      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│   React preview (frontend/) — not default production deploy      │
│   Today, Orders preview, Floral Asset Library                    │
└─────────────────────────────────────────────────────────────────┘
```

**Deep dive:** `docs/FLORISYN_REPOSITORY_AUDIT.md`

---

## 3. Tenant isolation & security

| Layer | Mechanism |
|-------|-----------|
| Database | RLS via `is_shop_member(shop_id)` |
| API | `currentUser()` → `shopId` on every mutation |
| Cross-tenant | `requireRowShopId()` → 403 |
| Audit | `audit_events` + `writeShopAudit()` where wired |
| Payments | Stripe server-only; webhook livemode guard |

**Full review:** `docs/SECURITY_REVIEW.md`  
**Production runbook:** `docs/FOUNDATION_PRODUCTION_RUNBOOK.md`

---

## 4. Core domain services (source of truth)

| Domain | API | Notes |
|--------|-----|-------|
| Orders | `orders.js` | Status workflow, history, validation |
| Customers | `customers.js` | CRM, dedup, contact preferences |
| Inventory | `inventory.js` | Freshness, markup, use-first |
| Products & recipes | `products.js`, `recipes.js` | Catalog + costing |
| Deliveries | `deliveries.js` | Proof of delivery, private storage |
| Payments | `payment-hub.js`, `payments.js`, Stripe | Payment Center |
| Settings / shop | `settings.js`, `shops` table | Branding, tax, domains |
| Floral Library | `floral-library.js` | Designs → products |
| AI | `lily-ai.js`, `ai-status.js` | Role-gated, honest status |

**Website Studio must consume these services — never fork parallel catalogs.**

---

## 5. Feature flags

Defined in `netlify/functions/_shared/feature-flags.js`. Override: `FLORISYN_FLAG_<NAME>=true|false`.

| Flag | Default | Meaning |
|------|---------|---------|
| `VOICE_WAKE` | false | Risky — off in production |
| `INVENTORY_AI_INTAKE` | false | Risky — off |
| `INVENTORY_RECIPE_DEDUCTIONS` | false | Risky — off |
| `REACT_ORDERS_PREVIEW` | false | React orders API preview |
| `INSTANT_WEBSITE` | true | Shipped RC1 instant website module |
| **`WEBSITE_STUDIO_V2`** | **false** | **Future full Website Studio editor (see §6)** |
| `DELIVERY_MAPS` | true | Route distance (degrades without API key) |
| `MARKETPLACE_PUBLIC` | true | Shipped marketplace browse |

Expose via `GET /.netlify/functions/production-health`.

---

## 6. Florisyn Website Studio (permanent specification)

**Full specification:** `docs/FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md`

### 6.1 Product summary

- **Goal:** Complete sales-ready florist website in **< 30 minutes**, no tutorial.
- **Default path:** Lily interview → full draft → visual approve → publish.
- **Quick starts:** Lily Build (recommended), Florisyn Design, Import, Start Blank.
- **Principle:** Never start from empty canvas for default users.

### 6.2 Editor model (target)

| Region | Responsibility |
|--------|----------------|
| Left | Pages, sections, reorder, draft/published/hidden |
| Center | Live canvas — click-to-edit, drag sections, responsive preview |
| Right | Contextual controls only (photo, copy, Lily rewrite, SEO preview) |

### 6.3 Integration requirements

Website Studio **must** integrate with:

- **Orders / Payment Center / production board** — web checkout → same pipeline as POS
- **Customers** — CRM + contact preferences (`customer-preferences.js`)
- **Inventory** — freshness, low stock, use-first (`inventory-freshness.js`)
- **Recipes & products** — publication from catalog, not duplicate tables
- **Delivery** — zones, fees, proof-capable delivery records
- **Floral Library** — one-click Add to Website
- **Lily** — draft generation with approval gate
- **SEO** — `docs/SEO_FOUNDATION.md` requirements
- **Holiday Command Center** — planned WS-4 (architecture slot)

### 6.4 Current codebase (RC1 precursor — not final Studio)

| Component | Location |
|-----------|----------|
| Instant website engine | `_shared/bloom-instant-website.js` |
| API | `instant-website.js` |
| UI shells | `instant-website-ui.js`, `website-editor-ui.js`, `theme-gallery-ui.js` |
| Public storefront | `storefront-public.js`, `public/storefront/` |
| Schema | `bloom_website_projects`, `bloom_website_pages`, `bloom_website_page_versions` |
| Legacy pages | `website_pages`, `shops.website_*` columns |

**Migration rule:** WS-0 unifies models before WS-2 visual editor ships at scale.

### 6.5 Build phases (checklist tracking)

| Phase | ID | Deliverable |
|-------|-----|-------------|
| Architecture | WS-0 | Models, contracts, versioning, permissions |
| Lily Quick Start | WS-1 | Interview → draft site |
| Visual Editor | WS-2 | Canvas + contextual panels |
| Products & Checkout | WS-3 | Publish + Stripe + order flow |
| Inventory & Holiday | WS-4 | Availability + command center |
| SEO & Publishing | WS-5 | Domains, analytics, pre-publish, rollback |
| Import & Mobile AI | WS-6 | Import, mobile ops, advanced Lily |

**Status:** ⚪ Planned — see Master Build Checklist § Website Studio.

### 6.6 Architectural blockers (resolve in WS-0)

1. **Dual website page storage** — legacy `website_pages` vs RC1 `bloom_website_pages`.
2. **Publishing state** — align `website_published`, project status, page-level draft.
3. **Checkout → OS** — complete storefront order creation + inventory hooks.
4. **Holiday Command Center** — module does not exist yet; define contract first.
5. **Structured data** — move JSON-LD to server-rendered storefront shell.
6. **Domain/SSL status** — production-grade connection UX.

Daily Loop v3 work (contact prefs, delivery proof, inventory freshness) **does not block** Website Studio — it **feeds** checkout and inventory-aware publishing.

---

## 7. Daily operating loop (shipped batches)

| Batch | Branch | Focus |
|-------|--------|-------|
| Foundation v1 | `build/florisyn-foundation-v1` | Migration, flags, order status, audit |
| Daily Loop v2 | `cursor/florisyn-daily-loop-v2-7317` | Session refresh, order board, dedup, house account |
| Daily Loop v3 | `cursor/florisyn-daily-loop-v3` | Contact prefs, delivery proof, freshness, React orders |

**Deploy stacking:** Foundation migration → v2 → v3 (no new migration for v2/v3 beyond Foundation).

Changelogs: `docs/FOUNDATION_CHANGELOG.md`, `docs/DAILY_LOOP_V2_CHANGELOG.md`, `docs/DAILY_LOOP_V3_CHANGELOG.md`.

---

## 8. React preview vs production

| Surface | Production | Preview |
|---------|------------|---------|
| Today | `#dashboardPage` in `public/` | `frontend/src/pages/TodayPage.tsx` |
| Orders | `ordersPage` board | `OrdersPage.tsx` when `REACT_ORDERS_PREVIEW=true` |
| Floral assets | Production library UI | Frozen catalog in `frontend/src/lib/floral-asset-library/` |

React app is **not** the default Netlify publish target. Preview must fall back to production routes when flags are off.

---

## 9. AI architecture

- **Lily:** Creative, marketing, website copy — approval before save/publish.
- **Rose:** Operational briefing on Today dashboard.
- **Status:** `ai-status.js` — never fake “online” without credentials.
- **Voice wake:** Flag off (`VOICE_WAKE: false`).

Platform drawer: `lily-platform.js`. Server engine: `lily-ai.js`.

---

## 10. Legal, SEO, cost, reliability

| Topic | Document |
|-------|----------|
| SEO | `docs/SEO_FOUNDATION.md` |
| Legal / compliance | `docs/LEGAL_COMPLIANCE_ARCHITECTURE.md` |
| Cost control | `docs/COST_CONTROL_PLAN.md` |
| Reliability | `docs/RELIABILITY_AND_RECOVERY.md` |

Website Studio SEO and legal page starters **require attorney review** before customer-facing publish (`LEGAL_COMPLIANCE_ARCHITECTURE.md`).

---

## 11. Development rules for all agents

1. Read **Governance Map** + this bible + **Gold Standard** + **Experience Standard** + **Design System** + **Ecosystem Portals** + checklist before large features.
2. Minimize diff scope; match existing conventions.
3. No deploy, no production migrations unless explicitly assigned.
4. Preserve Today page and Floral Asset Library architecture.
5. Wire new features to existing domain APIs (**Gold Standard §1, §10**).
6. Add tests for security-sensitive paths.
7. Update checklist status when shipping.
8. Website Studio: follow blueprint phases — **no surprise full builds**.
9. AI features: preview + Accept/Edit/Reject — **never silent mutations** (**Gold Standard §4**).
10. Prefer recovery (undo, audit, rollback) over raw speed for orders, payments, and publish (**Gold Standard §6**).

---

## 12. Document index

| Document | Role |
|----------|------|
| **`FLORISYN_GOVERNANCE_MAP.md`** | **Documentation entry point — which doc to use** |
| **This file** | Master architecture & integration bible |
| **`FLORISYN_GOLD_STANDARD.md`** | **Permanent product principles (10 rules)** |
| **`FLORISYN_EXPERIENCE_STANDARD.md`** | **Permanent UX & visual design constitution** |
| **`FLORISYN_DESIGN_SYSTEM.md`** | **v1.0 UI tokens, components, layout patterns** |
| **`FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md`** | **Florist / Wholesaler / Platform Owner portal model** |
| **`FLORISYN_PORTAL_OWNERSHIP_MATRIX.md`** | **Shared service ownership by portal** |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Ship status by product area |
| `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` | Permanent Website Studio specification |
| `FLORISYN_REPOSITORY_AUDIT.md` | Codebase inventory |
| `SECURITY_REVIEW.md` | Security controls & gaps |
| `FOUNDATION_PRODUCTION_RUNBOOK.md` | Deploy & smoke tests |
| `SEO_FOUNDATION.md` | SEO implementation map |

---

*Maintained by Florisyn engineering. Governance Map added 2026-07-30. Portal Ownership Matrix added 2026-07-30. Website Studio specification added 2026-07-30. Gold Standard principles added 2026-07-30. Experience Standard added 2026-07-30. Ecosystem Portals Standard added 2026-07-30. Design System v1.0 added 2026-07-30.*
