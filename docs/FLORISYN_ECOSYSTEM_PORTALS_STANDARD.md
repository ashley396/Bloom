# Florisyn Ecosystem Portals Standard

**Permanent architecture for role-based portals on one operating system**

**Last updated:** 2026-07-30  
**Status:** Permanent — applies to all Florisyn modules, agents, and releases  
**Authority:** Owner-approved portal model; supersedes ad-hoc portal or duplicate-system designs that conflict with this document.

---

## Vision

Florisyn is **one operating system** with **multiple role-based portals**.

Each portal shares the same **design system**, **security model**, and **core services**. Portals expose different capabilities based on role — they **do not create duplicate systems**.

**Companion standards:**

| Document | Scope |
|----------|-------|
| `FLORISYN_GOLD_STANDARD.md` | Product behavior — especially §1 Single Source of Truth, §10 Future Ecosystem |
| `FLORISYN_EXPERIENCE_STANDARD.md` | Visual language and completion gate — all portals use one design system |
| `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` | Integration index, tenant isolation, domain APIs |

---

## Portal 1 — Florist

**Purpose:** Run a flower shop.

**Primary audience:** Shop owners, designers, drivers, front-counter staff.

### Core modules

| Module | Purpose | Production surface (current) |
|--------|---------|------------------------------|
| **Today** | Daily command center — KPIs, Up Next, Rose briefing | `#dashboardPage` — **approved anchor; do not redesign without owner approval** |
| **Orders** | Production board, status workflow, history | `ordersPage`, `orders.js` |
| **POS** | In-shop sales and quick order entry | Order flows in `public/app.js` |
| **Customers** | CRM, dedup, contact preferences, house accounts | `customersPage`, `customers.js` |
| **Payments** | Payment Center, Stripe, manual payments | `paymentsPage`, `payment-hub.js` |
| **Inventory** | Stock, freshness, markup, use-first | `inventoryPage`, `inventory.js` |
| **Floral Library** | Designs → products | `libraryPage`, `floral-library.js` |
| **Delivery** | Routes, proof of delivery, driver assignment | `deliveriesPage`, `deliveries.js` |
| **Website Studio** | Sales-ready florist website | `websitePage`, instant-website modules — see Website Studio blueprint |
| **Reports** | Shop analytics and exports | `reportsPage` |
| **Lily & Rose** | Creative AI (Lily) + operational briefing (Rose) | `lily-platform.js`, `lily-ai.js`, Today dashboard |

**Tenant scope:** `shop_id` via `is_shop_member()` — every API mutation is shop-scoped.

**Default portal:** This is the shipped production SPA (`public/`). All other portals extend or administer the same underlying services.

---

## Portal 2 — Wholesaler

**Purpose:** Supply florists efficiently.

**Primary audience:** Farm and wholesale sellers, fulfillment staff, account managers.

### Core modules

| Module | Purpose | Current / planned surface |
|--------|---------|---------------------------|
| **Product Catalog** | Listings, SKU, publish workflow | `wholesaleSellerPage`, `marketplace-seller.js` |
| **Inventory** | Available quantity, availability windows | Seller dashboard + shared `inventory` model where linked |
| **Availability** | What can be ordered now vs scheduled | Listing fields + farm arrival hooks |
| **Pricing** | Unit price, minimums, terms | Listing + `payment-hub.js` wholesale terms |
| **Farm Arrivals** | Incoming supply, ETA, allocation | 🔒 Planned — must not fork inventory tables |
| **Order Management** | Wholesale orders from florists | `marketplace_wholesale_orders`, seller order views |
| **Fulfillment** | Pick, pack, ship status | Seller dashboard fulfillment — shared order status vocabulary where possible |
| **Delivery Scheduling** | Outbound delivery to florist shops | Shared `deliveries` model or wholesale-specific extension — **no parallel delivery system** |
| **Customer Accounts** | Florist buyer accounts, verification | `marketplace-verification.js`, florist business profiles |
| **Analytics** | Seller KPIs, volume, revenue | Seller dashboard metrics |

**Tenant scope:** Wholesaler operates on `wholesaler_shop_id` (or equivalent seller shop record). Florist buyers remain `florist_shop_id` in verification and order linkage.

**Integration rule:** Wholesale purchases create or update records in the **same** order, payment, inventory, and customer services — not shadow catalogs.

**Feature flag:** `WHOLESALE_SELLER` — gate incomplete seller capabilities until production-ready.

---

## Portal 3 — Platform Owner

**Purpose:** Operate and grow the Florisyn platform.

**Primary audience:** Florisyn HQ owner and platform administrators — **not** flower-shop staff.

### Core modules

| Module | Purpose | Current / planned surface |
|--------|---------|---------------------------|
| **Tenant Management** | Shops, onboarding, suspension | `admin-command-center.js`, shop records |
| **Subscription & Billing** | Plans, entitlements | `subscription-center-ui.js`, subscription APIs |
| **Feature Flags** | Platform and per-tenant flags | `feature-flags.js`, `production-health.js` |
| **Security** | Auth policies, RLS review, incident response | `SECURITY_REVIEW.md`, Supabase dashboard |
| **Audit Logs** | Cross-tenant audit where authorized | `audit_events`, admin views |
| **Marketplace Administration** | Verification review, listing moderation | `marketplace-verification-review.js`, admin command center |
| **Wholesaler Administration** | Seller approval, compliance | Admin + verification review flows |
| **AI Usage** | Lily/Rose consumption, limits, cost | `ai-status.js`, cost control plan |
| **Support** | Owner support tools, impersonation (if ever) | 🔒 Planned — must be heavily audited |
| **Platform Analytics** | MRR, active shops, marketplace GMV | `admin-command-center.js` aggregates |
| **System Health** | Deploy status, function health, flags | `health.js`, `production-health.js` |

**Access model:** Separate **platform owner** auth (`public/admin.html`, owner bootstrap) — distinct from florist staff login. Platform actions must never bypass shop RLS for routine operations; break-glass service role is documented and rare.

**Tenant scope:** Platform-wide read/admin; mutations to shop data only through audited admin paths.

---

## Shared platform rules

There is **one** of each — shared across all portals:

| Shared service | Canonical implementation | Portals consume via |
|----------------|-------------------------|---------------------|
| **Customer model** | `customers` table + `customers.js` | Florist CRM; wholesaler buyer profiles link to florist shops |
| **Product model** | `products`, listings, Floral Library | Florist catalog; wholesaler listings; Website Studio publish |
| **Inventory model** | `inventory` + freshness helpers | Florist cooler; wholesaler availability (linked, not duplicated) |
| **Order model** | `orders` + status history | POS, web checkout, wholesale orders |
| **Payment model** | Stripe + `payments.js`, `payment-hub.js` | Florist Payment Center; marketplace settlement |
| **Delivery model** | `deliveries` + proof storage | Florist delivery board; wholesaler outbound (same schema) |
| **Authentication system** | Supabase Auth + shop membership | Florist staff JWT; platform owner separate surface |
| **Design system** | `FLORISYN_DESIGN_SYSTEM.md` + `public/styles.css` | All portals — tokens and shared components |
| **Notification system** | Transactional email + in-app toasts | Shared templates and delivery status |
| **AI platform** | Lily + Rose + `ai-status.js` | Florist creative/ops; platform AI usage metering |

**Portals expose different capabilities based on role — they do not create duplicate systems.**

Violations to reject in code review:

- Wholesaler-only `orders_v2` table
- Platform admin UI that writes customer PII without audit
- Website Studio product SKUs with no `products` linkage
- Separate auth store per portal

---

## Portal routing model (target)

```
                    ┌─────────────────────────────┐
                    │   Shared core services       │
                    │   (Postgres + Netlify APIs)  │
                    └──────────────┬──────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Portal 1        │    │ Portal 2        │    │ Portal 3        │
│ Florist         │    │ Wholesaler      │    │ Platform Owner  │
│ public/app.js   │    │ wholesaleSeller │    │ admin.html      │
│ shop-scoped RLS │    │ seller shop id  │    │ platform auth   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

Future mobile apps and APIs attach to the **same** service layer — new portals, not new databases.

---

## Permanent feature gate

Before any new feature is considered **complete**, answer:

| Question | Required answer |
|----------|-----------------|
| **Which portal uses it?** | Florist, Wholesaler, Platform Owner — or explicitly shared (all) |
| **Which shared services does it rely on?** | Named APIs/tables — no new parallel domain |
| **Does it maintain a single source of truth?** | Yes — Gold Standard §1 |
| **Does it follow the Gold Standard and Experience Standard?** | Yes — product + UX constitution |

**If any answer is unclear or "No", the feature is not complete.**

Document portal assignment in PR descriptions and update `FLORISYN_MASTER_BUILD_CHECKLIST.md` when shipping.

---

## Current maturity (honest status)

| Portal | Shipped | In progress | Future |
|--------|---------|-------------|--------|
| **Florist** | Today, Orders, CRM, Payments, Inventory, Delivery, Library, Reports | Website Studio WS-0…WS-6, React previews | Holiday Mode |
| **Wholesaler** | Seller dashboard, marketplace browse, verification | Fulfillment, farm arrivals | Full Portal 2 shell |
| **Platform Owner** | Admin command center, health endpoints, verification review | Subscription admin | Support impersonation, full analytics |

This standard describes the **target architecture**. Partial implementations must still obey shared-platform rules and must not fork domain models.

---

## Application to development

All agents and engineers must:

1. Read this standard before adding portal-specific UI or APIs.
2. Tag new modules with portal ownership (Florist / Wholesaler / Platform Owner).
3. Route all domain mutations through existing shop-scoped services.
4. Apply Experience Standard visual language in every portal — one app, many roles.
5. Escalate to owner when a feature appears to require a second source of truth.

**Conflicts:** Gold Standard §1 wins over portal convenience. Experience Standard wins on cross-portal visual consistency. Escalate unresolved portal-boundary questions to owner.

---

## Document index

| Document | Relationship |
|----------|--------------|
| `FLORISYN_GOLD_STANDARD.md` | §1, §10 — single source of truth and ecosystem |
| `FLORISYN_EXPERIENCE_STANDARD.md` | UX constitution across portals |
| `FLORISYN_DESIGN_SYSTEM.md` | v1.0 tokens and component catalog |
| `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` | Florist portal module — Website Studio |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Portal module ship status |
| `SECURITY_REVIEW.md` | Platform Owner security and RLS |
| `FLORISYN_REPOSITORY_AUDIT.md` | Codebase inventory by area |

---

*Permanent portal architecture — Florisyn Ecosystem Portals Standard. Added 2026-07-30.*
