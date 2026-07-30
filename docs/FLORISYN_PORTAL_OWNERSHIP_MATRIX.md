# Florisyn Portal Ownership Matrix

**Shared service ownership across Florist, Wholesaler, and Platform Owner portals**

**Last updated:** 2026-07-30  
**Status:** Permanent — applies to all Florisyn modules, agents, and releases  
**Authority:** Complements `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` and reinforces Gold Standard §1 (Single Source of Truth).

---

## Purpose

Define which portal **owns**, **manages**, or **consumes** each shared platform service.

This matrix answers: *Who is the primary actor for this workflow?* Role permissions determine **visibility and actions** — not duplicate databases.

**Companion documents:**

| Document | Relationship |
|----------|--------------|
| `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` | Portal definitions, modules, shared platform rules |
| `FLORISYN_GOLD_STANDARD.md` | §1 Single Source of Truth, §10 Future Ecosystem |
| `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` | Canonical APIs and tenant model |
| `FLORISYN_EXPERIENCE_STANDARD.md` | UX completion gate per portal |
| `FLORISYN_DESIGN_SYSTEM.md` | Shared visual language across portals |

---

## Ownership matrix

| Shared service | Florist Portal | Wholesaler Portal | Platform Owner Portal |
|----------------|----------------|-------------------|------------------------|
| **Customers** | Create & manage shop customers | View / manage wholesale customer accounts | Global governance & tenant oversight |
| **Products** | Browse, price, sell | Create, update, publish catalogs | Governance, taxonomy, moderation |
| **Inventory** | Shop inventory | Warehouse inventory | Cross-platform analytics |
| **Orders** | Retail orders | Wholesale orders | Monitoring & reporting |
| **Payments** | Accept customer payments | Accept wholesale payments | Subscription billing & platform finance |
| **Delivery** | Schedule & complete deliveries | Ship wholesale orders | Operational analytics |
| **Website Studio** | Build storefront | Publish product catalog pages | Platform settings & templates |
| **Lily & Rose AI** | Shop assistant | Wholesale assistant | Administrative insights |
| **Marketplace** | Purchase inventory | Sell inventory | Marketplace administration |
| **Reports** | Business reports | Warehouse reports | Platform-wide analytics |
| **Users** | Shop staff | Warehouse staff | Tenant administration |
| **Security** | Role-based access | Role-based access | Platform security & audit logs |

### Legend

| Term | Meaning |
|------|---------|
| **Own / manage** | Primary workflow owner — creates and mutates records through canonical APIs |
| **Consume** | Reads or acts on shared records within scoped permissions (e.g. florist buys from marketplace listing) |
| **Govern / oversee** | Platform-level visibility, moderation, billing, or audit — not a second data store |

---

## Canonical implementation map

Each row in the matrix maps to **one** canonical service — never a portal-specific fork.

| Shared service | Canonical model / API | Florist surface | Wholesaler surface | Platform Owner surface |
|----------------|----------------------|-----------------|--------------------|-------------------------|
| Customers | `customers.js`, `customers` table | CRM, order buyer | Buyer verification profiles | Tenant oversight, admin |
| Products | `products.js`, listings, Floral Library | Catalog, POS, library | Seller catalog, publish | Moderation, taxonomy |
| Inventory | `inventory.js`, `inventory` table | Cooler, freshness | Warehouse qty, availability | Aggregated analytics |
| Orders | `orders.js`, `marketplace_wholesale_orders` | Retail / POS orders | Wholesale fulfillment | Monitoring dashboards |
| Payments | `payment-hub.js`, `payments.js`, Stripe | Payment Center | Wholesale settlement | Subscriptions, platform finance |
| Delivery | `deliveries.js`, `deliveries` table | Delivery board, proof | Outbound ship status | Ops analytics |
| Website Studio | `instant-website.js`, bloom website schema | `websitePage` | Catalog page publish | Templates, platform settings |
| Lily & Rose AI | `lily-ai.js`, Today briefing | Creative + ops assist | Listing copy assist | Usage metering, limits |
| Marketplace | `marketplace*.js`, verification | Browse, purchase | Sell, verify buyers | Admin review, moderation |
| Reports | `reports.js`, dashboards | Shop KPIs | Seller metrics | `admin-command-center.js` |
| Users | Supabase Auth, shop membership | `staffPage` | Seller staff (planned) | `admin.html`, owner auth |
| Security | RLS, `is_shop_member()`, audit | Shop-scoped JWT | Seller shop scope | Platform audit, flags |

---

## Governance rules

1. **Every shared service has one canonical data model.**  
   No `customers_wholesale`, `orders_v2`, or portal-only product tables.

2. **Role permissions determine visibility — not duplicate databases.**  
   RLS and API scoping filter the same tables; portals do not sync shadow copies.

3. **New features must identify:**
   - **Which portal owns the workflow?** (Florist / Wholesaler / Platform Owner)
   - **Which shared services are affected?** (Named APIs/tables from matrix above)
   - **How the Single Source of Truth is preserved.** (No parallel writes; link to canonical IDs)
   - **Compliance with the Gold Standard and Experience Standard.**

4. **Cross-portal workflows** (e.g. florist purchases from wholesaler) create or update records in the **same** order, payment, and inventory services — linked by shop IDs and verification, not duplicated entities.

5. **Platform Owner** mutations to shop data require audited admin paths; routine operations never bypass shop RLS for convenience.

Document portal ownership in PR descriptions and update `FLORISYN_MASTER_BUILD_CHECKLIST.md` when shipping.

---

## Feature gate (use with Ecosystem Portals Standard)

Before any feature is **complete**:

| Question | Required |
|----------|----------|
| Which portal owns the workflow? | Row in ownership matrix |
| Which shared services are affected? | Named in matrix / bible §4 |
| Single Source of Truth preserved? | Yes — Gold Standard §1 |
| Gold Standard + Experience Standard? | Yes |

---

## Long-term objective

Every portal should feel **purpose-built for its users** while remaining part of **one cohesive Florisyn platform**.

- Florists experience a calm, shop-first POS — not a generic admin tool.
- Wholesalers experience supply-chain efficiency — not a stripped-down florist app.
- Platform owners see governance and health — not three unrelated products.

One OS. Three portals. One truth per business object.

---

## Document index

| Document | Role |
|----------|------|
| `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` | Portal architecture and module lists |
| `FLORISYN_GOLD_STANDARD.md` | Product principles and decision hierarchy |
| `FLORISYN_GOVERNANCE_MAP.md` | Which constitution doc to read first |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Ship status by portal and service |
| `SECURITY_REVIEW.md` | RLS and platform security detail |

---

*Florisyn Portal Ownership Matrix. Added 2026-07-30.*
