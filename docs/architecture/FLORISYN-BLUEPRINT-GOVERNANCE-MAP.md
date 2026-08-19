# FLORISYN Blueprint Governance Map

**Status:** Governing implementation map
**Effective date:** August 5, 2026
**Scope:** Reconcile the complete supplied blueprint set with the current repository and release program.
**Deployment authority:** This document does not authorize production changes, feature activation, Git publication, or deployment.

## 1. Source Authority

When sources overlap, agents and contributors must use this order:

1. **Florisyn Master Architecture & Development Bible v1.0** — product principles, sequencing, system boundaries, and definition of success.
2. **Florisyn Master Feature Blueprint** — complete feature inventory and design-standard checklist; it defines what belongs in FLORISYN but does not move a feature ahead of the Bible's phase order.
3. **Module blueprints** — detailed requirements inside their governing phase:
   - Florisyn Owner/Admin Blueprint
   - Florisyn Wholesalers Page Blueprint
4. **FLORISYN Scalability, Performance, and Stability Blueprint** — capacity, performance, security, and reliability constraints that support every phase without changing product priority.
5. **Audits, execution plans, tests, and release evidence** — current implementation truth; these prove readiness but do not override the product authority above.

| Supplied source | SHA-256 | Governing use |
|---|---|---|
| `Florisyn_Master_Architecture_Development_Bible_v1.0.docx` | `53cf2a6e3485cd0dff4649ce551160d017e6f421e60bcbbc4738a0adb4bc6499` | Master product and phase authority |
| `Florisyn_Master_Feature_Blueprint.docx` | `d0e7c6aae7cac81984d5757f0e459f2c84ba7f62159157c6843a7bbd7b149367` | Complete feature inventory and design standards |
| `Florisyn_Owner_Admin_Blueprint.docx` | `253d487e23edaf8d7b45d36db16006c580f8bfd73014fa51d14dbfdfc1b329ea` | Owner/Admin module requirements |
| `Florisyn_Wholesalers_Page_Blueprint.docx` | `91ee20e73b1cc53f4166eb6e9844b376ac9b7e4c48ed1410734a86733ec842f1` | Marketplace and vendor module requirements |

Any replacement blueprint must be explicitly identified, hashed, reviewed against this map, and approved before it changes implementation scope.

## 2. Immutable Product Rules

The product decision order is:

1. Florist safety
2. Existing approved experience
3. Simplicity
4. Commercial usefulness
5. Beauty
6. Automation
7. Future expansion

The following rules are non-negotiable:

- **Today is PRESERVE.** Do not redesign the approved Today-page foundation. Complete missing behavior and correct defects without changing its established experience unless separately approved.
- **The daily operating loop is the release wedge:** customer contact → order → payment → recipe/production → inventory → delivery/pickup → receipt/invoice → reporting.
- No feature may weaken tenant isolation, RLS, payment integrity, auditability, rollback, or florist control.
- Existing agents and disciplines keep their scopes. Shared changes must be coordinated; no blueprint creates permission to replace another agent's work.
- Future modules may be architected and safely feature-gated, but must not appear as complete or be activated before their governing phase passes.
- Build the largest safe, tested batch. Prefer one controlled release after verification over repeated uncoordinated deployments.

## 3. Required Classification Before Coding

Every meaningful requirement or repository surface must be classified before implementation:

| Class | Meaning | Required action |
|---|---|---|
| **PRESERVE** | Approved and working experience | Protect with regression tests; change only to repair or complete behavior |
| **COMPLETE** | In current phase but unfinished | Implement to the governing blueprint and pass release gates |
| **FOUNDATION** | Shared prerequisite for multiple modules | Build narrowly, securely, and without prematurely exposing future features |
| **ARCHITECT** | Design now for a later phase | Define contracts/data boundaries; keep inactive and feature-gated |
| **FUTURE** | Outside current approved phase | Document and defer; do not imply availability |

## 4. Repository-to-Blueprint Classification

### PRESERVE

- Approved Today-page design and primary daily workflow presentation.
- Existing Netlify-hosted application shape and Supabase Auth/Postgres/RLS boundary unless evidence requires an extension.
- P0 tenant isolation, atomic order creation, server-controlled payment fields, onboarding convergence, and migration reproducibility controls.
- Working customers, orders, inventory, delivery/pickup, staff basics, and owner support behavior already inside the verified closed-beta loop.

### COMPLETE

- End-to-end reliability for the complete daily operating loop in the Bible's order.
- Hosted staging browser/function verification for the exact candidate source.
- Distributed authentication admission, bounded upstream requests, request correlation, session resilience, and graceful overload behavior.
- Missing accessibility, empty/loading/error/degraded states and honest write confirmation across core workflows.
- Idempotency for financial and order mutations, measured query/index improvements, RLS performance regression proof, monitoring, and recovery evidence.
- Owner controls required to operate and support closed-beta shops safely, including audit, feature flags, rollback, and strict role boundaries.

### FOUNDATION

- Shared tenant, product, inventory, order, payment, audit, notification, and feature-flag contracts that later modules may reuse.
- Safe draft → preview → validate → restore point → approve → publish → monitor → rollback mechanics for future Owner Experience Editor work.
- Marketplace-compatible product/vendor/order fields only where they do not complicate or expose the current florist workflow.
- Capacity controls and observability needed to certify 1,000 concurrent login attempts and later 10,000 authenticated sessions.

### ARCHITECT

- Advanced Owner Experience Editor, visual page composition, theme inheritance, staged publishing levels, and tenant-by-tenant experience overrides.
- Wholesalers marketplace storefronts, landed-cost multi-vendor cart, vendor portal, buying groups, standing orders, smart buying, and owner marketplace administration.
- Shared wholesale-order-to-inventory integration. Preserve existing gated code and schemas, but do not activate the marketplace or claim completion.
- Later Website/Holiday, Events, Networks, and ecosystem modules where interfaces must remain compatible with the core loop.

### FUTURE

- Public marketplace activation and broad wholesaler onboarding.
- Advanced autonomous AI, voice-first operation, University/community expansion, and speculative ecosystem features.
- 50,000-session infrastructure features until measured capacity evidence justifies them.

## 5. Governing Phase Order

1. **Phase 0 — Protect and audit:** preserve approved experience, classify work, close security and reproducibility risks.
2. **Phase 1 — Daily loop reliability:** make the full florist operating loop dependable and release-verifiable.
3. **Phase 2 — Production intelligence:** deepen recipes, production planning, purchasing signals, and operational insight.
4. **Phase 3 — Floral Library:** mature the governed knowledge/library capability.
5. **Phase 4 — Website and Holiday:** expand customer-facing publishing and seasonal workflows.
6. **Phase 5 — Delivery, Accounts, and Events:** expand coordinated business operations.
7. **Phase 6 — Networks and Marketplace:** activate wholesalers only after the shared core and trust controls pass.
8. **Phase 7 — Ecosystem expansion:** advanced owner editing, automation, learning/community, and other mature-platform capabilities.

A module blueprint may divide its own work into internal phases, but those phases operate inside—not ahead of—the Master Bible phase that authorizes the module.

## 6. Owner/Admin Boundaries

The Owner/Admin blueprint is accepted as the detailed target for platform governance. Current closed-beta work may COMPLETE the minimum support plane: shop visibility, audit review, feature flags, safe operational controls, subscription/support visibility, and rollback-ready changes.

Advanced experience editing is ARCHITECT until the Master Bible reaches its later ecosystem phase. Every future editor change must be scoped to one of three explicit publishing levels, retain restore points, validate before publish, record the actor and change, and prevent a florist admin or employee from acquiring platform-owner authority.

Owner access must never become an undocumented tenant bypass. Sensitive support access requires an explicit purpose, least privilege, audit evidence, and time-bounded behavior where practical.

## 7. Wholesalers Boundaries

The Wholesalers blueprint is accepted as the detailed Phase 6 target. Existing marketplace code is not deleted merely because it is deferred; it is preserved, tested for fail-closed behavior, and kept unavailable through explicit feature flags and authorization.

Before activation, the marketplace requires:

- vendor identity and approval controls;
- tenant-safe catalog, pricing, cart, order, payment, and reporting policies;
- landed-cost transparency and unambiguous multi-vendor checkout behavior;
- wholesale order-to-inventory integrity and idempotency;
- privacy rules preventing unauthorized florist, vendor, and cross-tenant data access;
- notification, dispute, refund, audit, and rollback runbooks;
- staged capacity and failure testing.

No current release artifact may describe Wholesalers as live, complete, or generally available.

## 8. Immediate Implementation Order

1. Finish the hosted staging proof for the current verified candidate without touching production.
2. Complete P0-17 authentication resilience and prove Netlify recognizes its edge admission rule.
3. Close core daily-loop gaps and degraded-state/idempotency requirements found by the full-system audit.
4. Implement RLS/query performance changes only through forward migrations and two-tenant regression tests.
5. Add observability, capacity dashboards, restore evidence, and the graduated staging load ladder.
6. Keep advanced Owner/Admin editing and Wholesalers in ARCHITECT/FUTURE status until the governing phase and activation gates are explicitly approved.

## 9. August 21, 2026 Public-Launch Scope

The approved first-public-launch target is **August 21, 2026**. This date is a release target, not permission to bypass security, hosted verification, recovery, or production approval gates.

The required launch wedge is:

- secure signup, login, recovery, onboarding, tenant isolation, permissions, and session resilience;
- Today preserved as the daily operating home;
- dependable core florist operations: customers, orders/POS, payments, products/recipes, inventory, delivery/pickup, expenses, invoices/receipts, and core reporting;
- essential Owner/Admin operations with strict platform-role boundaries, audit visibility, safe support controls, backups, and rollback readiness;
- a polished, mobile-responsive florist website builder with templates/themes, branding, editable/reorderable sections, product catalog, preview, SEO basics, contact/inquiry flow, and controlled FLORISYN-hosted publishing;
- useful, honest first versions of **Lily**, **Rose**, and **Daisy**, with core florist workflows remaining available when AI or optional services are offline;
- premium typography, spacious layouts, responsive behavior, accessible states, monitoring, rate limiting, graceful degradation, and release-appropriate capacity evidence.

The following cannot block this first launch and must remain gated unless independently proven ready: Wholesalers/Marketplace, advanced drag-anywhere editing, marketplace payments/disputes/vendor verification, autonomous AI, and other later-phase ecosystem capabilities.

Optional Master Feature Blueprint items may be added only after every required launch item above is green. “Fit in more” never permits reducing security, stability, accessibility, recovery, or honest feature-state requirements.

## 10. Change and Release Gates

Every candidate batch must show:

- classification and blueprint traceability;
- tenant/security regression results;
- build, syntax, dependency, and automated-test results;
- staged functional and degraded-state behavior;
- migration rehearsal and rollback/recovery evidence when data changes;
- feature-flag state for deferred modules;
- exact deployment target and explicit authorization for hosted writes.

Production database changes, production deployment, production load testing, Git commit/push/merge, feature activation, and third-party credential changes remain separate approval gates.

Uploading the current working tree to a hosted build service transmits uncommitted repository source and configuration to that provider. It must not be attempted after a denied or interrupted upload without renewed explicit authorization acknowledging that scope. Production secrets must never be substituted for unavailable staging credentials.

## 11. Definition of Blueprint Compliance

FLORISYN is blueprint-compliant only when:

- the florist daily loop is safe, coherent, and verified end to end;
- Today remains recognizably the approved foundation;
- current-phase modules work honestly across success, empty, loading, degraded, and failure states;
- tenant, role, payment, audit, recovery, and performance controls pass their evidence gates;
- later modules remain clearly classified and unavailable until approved;
- release claims match hosted evidence, not local intent.
