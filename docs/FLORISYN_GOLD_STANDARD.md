# Florisyn Gold Standard — Permanent Product Principles

**Last updated:** 2026-07-30  
**Status:** Permanent — applies to all Florisyn modules, agents, and releases  
**Authority:** Owner-approved product north star; supersedes ad-hoc UX or architecture decisions that conflict with these principles.

---

## Permanent goal

Florisyn should become the software florists recommend because it is **dependable**, **beautiful**, **understandable**, and clearly built around the way real flower shops operate.

---

## 1. Single Source of Truth

Every business object exists **only once**.

Orders, Customers, Products, Inventory, Payments, Deliveries, Recipes, Website Pages, and Staff records must **never be duplicated** across modules.

| Rule | Implementation expectation |
|------|---------------------------|
| One canonical table/API per domain | Website Studio, Marketplace, POS, and mobile surfaces **consume** existing services — never fork parallel catalogs |
| Cross-module reads | Join or fetch through shop-scoped APIs; no shadow copies in localStorage or duplicate Supabase tables |
| Publish flows | Website product pages reference `products` / Floral Library records; checkout creates real `orders` |
| Staff & permissions | One staff record per person per shop; RBAC reads from the same source |

**Violations to reject in code review:** duplicate customer tables, parallel order pipelines, website-only product SKUs without catalog linkage, inventory counts maintained in two places.

---

## 2. Florist First

Whenever there is a choice between technical elegance and making a florist's day easier, **choose the florist**.

| Guideline | Example |
|-----------|---------|
| Plain language over jargon | "Ready for delivery" not "status transition complete" |
| Sensible defaults | Pre-fill shop tax rate, delivery zone, card message templates |
| Forgiving inputs | Accept phone formats florists actually type; normalize server-side |
| Peak-season empathy | Design for gloved hands, ringing phones, and interrupted workflows |

Technical debt is acceptable when it reduces daily friction for shop staff. Refactor later; ship clarity first.

---

## 3. Calm Software

The interface should **reduce stress** during Valentine's Day, Mother's Day, funerals, and weddings.

- **No clutter** — hide advanced controls until needed; progressive disclosure over dense forms
- **No unnecessary clicks** — see also §5 One Click Rule
- **Visual hierarchy** — urgent production and delivery items surface first; marketing features defer during peaks
- **Stable layout** — avoid surprise navigation changes during holiday releases

Calm does not mean boring. It means predictable, readable, and respectful of cognitive load under pressure.

---

## 4. Explainable AI

Every AI suggestion must include:

1. **Why** it was suggested  
2. **What** will change  
3. **A Preview**  
4. **Accept / Edit / Reject**

**AI never silently changes business data.**

| Requirement | Status target |
|-------------|---------------|
| Lily website copy | Draft → preview → explicit publish |
| Inventory or pricing suggestions | Preview diff before apply |
| Order or customer mutations | Forbidden without human confirmation |
| Honest availability | `ai-status.js` reports real configuration — never fake "online" |

See `docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` §9 (AI architecture).

---

## 5. One Click Rule

Common daily tasks should be achievable in **one or two clicks**:

| Task | Target path |
|------|-------------|
| Create order | Today or Orders → New order (≤2 clicks from signed-in home) |
| Take payment | Order context → Payment Center |
| Publish product | Catalog → Publish (or Add to Website from Floral Library) |
| Print card | Order → Print card / production ticket |
| Route delivery | Deliveries → assign route or driver |
| Update inventory | Inventory → inline edit or quick receive |
| Publish website changes | Website Studio → Review → Publish |

If a workflow requires more than two clicks for a daily action, document the exception and plan a simplification.

---

## 6. Recovery Before Speed

Every important action should support:

- **Undo** (where safe and bounded)
- **Version history** (websites, published content, major config)
- **Rollback** (deploy, migration, publish — documented in runbooks)
- **Audit history** (`audit_events`, order status history, payment records)

Speed matters, but **recoverability matters more** for orders, payments, and customer data.

| Domain | Recovery mechanism |
|--------|-------------------|
| Orders | Status history; soft-delete customers; no hard-delete without audit |
| Payments | Stripe records + webhook reconciliation; manual payment log |
| Websites | Page versioning (`bloom_website_page_versions`); publish rollback in WS-5 |
| Deployments | Netlify publish rollback; migration rollback SQL in `supabase/rollback/` |

See `docs/RELIABILITY_AND_RECOVERY.md` and `docs/STACKED_RELEASE_ROLLBACK.md`.

---

## 7. Holiday Mode

The entire application should **automatically simplify workflows** during major floral holidays:

- Faster order entry
- Larger production board
- Capacity awareness
- Delivery optimization
- Inventory alerts

Holiday Mode is a **product capability**, not a theme swap. It adjusts information density, defaults, and alerts based on calendar peaks (Valentine's, Mother's Day, prom, funeral season spikes, wedding weekends).

**Current status:** 🔒 Planned — architecture slot in Website Studio WS-4 (Holiday Command Center) and production board enhancements. Feature-flag any partial implementation until full peak-season QA.

---

## 8. Delight

Small touches matter:

- Beautiful animations ( purposeful, not distracting )
- Premium typography ( readable at arm's length on a shop counter )
- Helpful empty states ( what to do next, not "No data" )
- Celebration after publishing a website
- Encouraging progress indicators

Delight must never block §3 Calm Software or §10 Performance Budget. Animations respect `prefers-reduced-motion`.

---

## 9. Performance Budget

| Target | Measure |
|--------|---------|
| Initial page load | **Under 2 seconds** on broadband (production SPA, cached assets) |
| Major actions | Feel instantaneous — optimistic UI where safe (save order, move board card) |
| Slow connections | Graceful degradation — skeleton states, retry, no infinite spinners |

| Surface | Budget note |
|---------|-------------|
| Production SPA (`public/`) | Primary budget owner — minimize blocking scripts |
| React preview (`frontend/`) | Dev/preview only unless flag-shipped |
| Netlify functions | Keep cold-start payloads lean; paginate large lists |
| Images | Floral Asset Library + delivery proofs — compress, lazy-load, signed URLs |

Regressions against this budget require explicit owner approval for release.

---

## 10. Future Ecosystem

Everything should plug into the **same platform**:

| Surface | Integration rule |
|---------|------------------|
| POS | Canonical — all domains originate here |
| Website Studio | Consumes catalog, orders, customers, inventory |
| Marketplace | Shared products, payments, verification |
| Wholesale Exchange | Extends inventory + seller flows |
| Bloom University | Content layer — no duplicate shop data |
| Community | Social layer — links to shop identity |
| Lily | Creative AI — approval gate on all mutations |
| Rose | Operational AI — read-only briefings on Today |
| Mobile apps | Same APIs, same tenant model |
| Future APIs | Public contract mirrors internal shop-scoped services |

No greenfield microservice may introduce a second source of truth for core business objects.

---

## Application to development

All agents and engineers must:

1. Read this document before proposing architecture or UX changes.
2. Cite the relevant principle in PR descriptions when making tradeoff decisions.
3. Reject features that duplicate domain data or bypass approval gates.
4. Update `FLORISYN_MASTER_BUILD_CHECKLIST.md` when shipping work that advances a principle.

**Conflicts:** If two principles conflict, priority order is **§1 Single Source of Truth → §6 Recovery → §2 Florist First → §3 Calm Software**. Escalate to owner if unresolved.

---

## Document index

| Document | Relationship |
|----------|--------------|
| `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` | Architecture index — §1 Product north star aligns with this file |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Verification tracking per principle |
| `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` | Website Studio must obey §1, §4, §5, §6 |
| `RELIABILITY_AND_RECOVERY.md` | §6 Recovery Before Speed |
| `SEO_FOUNDATION.md` | §9 Performance + §8 Delight (structured data, Core Web Vitals) |

---

*Permanent product principles — Florisyn Gold Standard. Added 2026-07-30.*
