# Florisyn Master Build Checklist

**Last updated:** 2026-07-30  
**Branch:** `cursor/florisyn-daily-loop-v3` (Daily Loop v3 on top of v2 → Foundation v1)  
**Legend:** ✅ COMPLETE · 🟡 IN PROGRESS · ⚪ PLANNED · 🔒 FUTURE · ⛔ BLOCKED

Each entry includes status, relevant files, dependencies, and verification method.

---

## Today

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Approved Today hero + Up Next layout | ✅ COMPLETE | `public/app.js`, `public/index.html`, `frontend/src/pages/TodayPage.tsx` | Shop settings branding | Visual QA; do not redesign |
| Dashboard KPIs + design queue | ✅ COMPLETE | `netlify/functions/dashboard.js`, `public/app.js` | Supabase orders/inventory | Load Today after login |
| React Today preview (sample data) | 🟡 IN PROGRESS | `frontend/src/pages/TodayPage.tsx`, Floral Asset Library | `npm run frontend:build` | Visit `/today` in Vite dev |
| Today → Orders handoff | ⚪ PLANNED | `frontend/src/App.tsx` | React API wiring | Click Up Next order card |

---

## Orders

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Create / edit orders (production) | ✅ COMPLETE | `public/app.js`, `netlify/functions/orders.js` | RLS, `orders` table | Add order, edit, save |
| Expanded status vocabulary | 🟡 IN PROGRESS | `_shared/order-status.js`, migration, `public/app.js` | Migration applied | Board shows full workflow |
| Status history (timestamped) | 🟡 IN PROGRESS | API + order dialog timeline | Migration applied | Edit order → history list |
| Align UI `NEW` column with `Pending` | ✅ COMPLETE | `boardColumnForStatus()` in `app.js` | — | NEW orders in Pending column |
| Customer/recipient search + reuse | ✅ COMPLETE | `public/app.js`, `customers.js` | CRM data | Order form autocomplete |
| Delivery address separate from billing | ✅ COMPLETE | Order form fields, `orders.js` validation | — | Create delivery order |
| Percentage tax | ✅ COMPLETE | Order form + totals in `app.js` | Shop tax rate in settings | Verify tax line on receipt |
| Order source + occasion | ✅ COMPLETE | Order form payload | — | Inspect saved order JSON |
| Card message + special instructions | ✅ COMPLETE | Order form | — | Print production ticket |
| Assigned designer / driver | ✅ COMPLETE | Order fields | Staff records | Assign on order edit |
| Transparent order totals | ✅ COMPLETE | Live total preview | — | Change line items |
| Post-create → Payment Center | ✅ COMPLETE | `openPaymentCenterForOrder()` in `app.js` | Stripe optional | Add order → lands on payments |
| Invoice nav destination | ✅ COMPLETE | Sidebar `invoicesPage`, `loadInvoices` | — | Click Invoices in nav |
| Compact receipt + production print | ✅ COMPLETE | Print CSS in `styles.css`, invoice render | — | Print from order/invoice |
| React Orders preview | 🟡 IN PROGRESS | `frontend/src/pages/OrdersPage.tsx`, `orders-api.ts` | `REACT_ORDERS_PREVIEW=false` default; API when flag on | Flag off → production fallback link |
| Customer contact preferences UI | ✅ COMPLETE | `customer-preferences.js`, `customers.js`, `public/index.html` | Foundation `contact_preferences` column | CRM + order builder summary |
| Delivery proof capture UI + API | ✅ COMPLETE | `delivery-proof.js`, `deliveries.js`, proof dialog | Private `delivery-proofs` bucket | Capture proof smoke in QA doc |
| Inventory freshness fields + filters | ✅ COMPLETE | `inventory-freshness.js`, `inventory.js`, inventory UI | Foundation inventory columns | Use First filter + save dates |
| Order audit log (full entity diff) | ⚪ PLANNED | `audit_events` table | Migration + handler wiring | Inspect audit_events |

---

## Customers

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| CRUD + search | ✅ COMPLETE | `customers.js`, `public/app.js` | RLS | Add/edit customer |
| Buyer vs recipient separation | ✅ COMPLETE | Order + customer models | — | Delivery to different recipient |
| Order history on customer | ✅ COMPLETE | Customer detail panel | Orders linked | Open customer record |
| House account flag | ✅ COMPLETE | Migration + customer form | Migration applied | House account checkbox |
| Soft delete | ✅ COMPLETE | Server `deleted_at` filter + soft DELETE | Migration applied | Delete hides customer |
| Duplicate prevention | ✅ COMPLETE | `_shared/customer-dedup.js` | — | 409 on duplicate phone/email |
| Contact preferences (operational vs marketing) | ✅ COMPLETE | `customer-preferences.js`, v3 UI | Foundation column | CRM + order builder |
| RBAC for PII | ✅ COMPLETE | RLS `is_shop_member()` | Supabase auth | Cross-shop access denied |

---

## Payments

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Stripe Checkout (server secret) | ✅ COMPLETE | `create-checkout.js`, `_shared/post-stripe-payment.js` | `STRIPE_SECRET_KEY` | Card payment flow |
| Payment Center UI | ✅ COMPLETE | `public/app.js`, `payment-center-polish.css` | Order context | Open from new order |
| Split / deposit / balance | ✅ COMPLETE | Split session in `app.js`, `payment-hub.js` | — | Partial then remainder |
| Manual cash/check/Zelle | ✅ COMPLETE | `payments.js` | — | Record manual payment |
| Missing env → clear admin error | ✅ COMPLETE | `payment-hub.js` 503 + message | — | Unset Stripe keys |
| Refunds / partial refunds | 🟡 IN PROGRESS | Stripe webhook handlers | Stripe dashboard | Refund in Stripe → webhook |
| Never auto-switch test→live | ✅ COMPLETE | Env-only mode | Owner sets keys | Confirm test keys in staging |

---

## Inventory

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Save inventory reliably | ✅ COMPLETE | `inventory.js`, `public/app.js` | RLS | Add/edit item |
| Item kinds (flower, container, etc.) | 🟡 IN PROGRESS | Migration `item_kind` column | Migration | Set kind on item |
| Color-level tracking | 🟡 IN PROGRESS | Migration `color` column | Migration | Rose color field |
| Markup multiplier (3× default) | 🟡 IN PROGRESS | Migration `markup_multiplier` | Migration | Default 3.0 on new rows |
| Freshness / use-first dates | ✅ COMPLETE | `received_at`, `use_by`, v3 UI/filters | Migration | Use First filter |
| Manual intake | ✅ COMPLETE | Inventory form | — | Add row manually |
| Barcode intake | ✅ COMPLETE | Scanner hooks in app | Hardware optional | Scan SKU |
| Voice intake | 🔒 FUTURE | Feature flag `INVENTORY_AI_INTAKE` off | AI + STT | — |
| Receipt/invoice photo intake | 🔒 FUTURE | `inventory-scan.js` partial | AI vision | Flag off |
| Recipe-driven deductions | 🔒 FUTURE | `recipes.js`, flag `INVENTORY_RECIPE_DEDUCTIONS` | Recipes linked | Flag off until tested |

---

## Floral Library

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Production library browser | ✅ COMPLETE | `floral-library.js`, `public/app.js` | — | Open Library page |
| Frozen React asset catalog | ✅ COMPLETE | `frontend/src/lib/floral-asset-library/` | Lint guards | `npm run lint` in frontend |
| Admin library uploads | ✅ COMPLETE | `floral-library-admin.js` | Storage bucket | Upload via admin |

---

## Delivery

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Delivery records + notes | ✅ COMPLETE | `deliveries.js`, order linkage | — | Create delivery order |
| Round-trip mileage | 🟡 IN PROGRESS | `route-distance.js`, migration `round_trip_*` | `GOOGLE_MAPS_API_KEY` | Calculate route on order |
| Assigned driver | ✅ COMPLETE | Order + delivery fields | Staff | Assign driver |
| Delivery status tracking | ✅ COMPLETE | Order status OUT_FOR_DELIVERY etc. | — | Move on board |
| Proof photo / signature | ✅ COMPLETE | `delivery-proof.js`, `deliveries.js`, v3 UI | Private `delivery-proofs` bucket | Daily Loop v3 QA |
| Maps abstraction + fallback | 🟡 IN PROGRESS | `route-distance.js`, flag `DELIVERY_MAPS` | API key or graceful degrade | Remove maps key → message |

---

## Website Studio

**Permanent specification:** `docs/FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md`  
**Architecture:** `docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` §6  
**Feature flag:** `WEBSITE_STUDIO_V2` default `false` (RC1 `INSTANT_WEBSITE` remains for shipped module)

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| **WS-0** Architecture (pages, sections, themes, domains, versioning) | ⚪ PLANNED | Blueprint § Build phases | Unify `website_pages` + `bloom_website_*` | Architecture review |
| **WS-1** Lily Quick Start (interview → draft site) | ⚪ PLANNED | Lily + `instant-website.js` extension | WS-0 models | 30-min setup QA |
| **WS-2** Visual Editor (canvas, contextual panels) | ⚪ PLANNED | New editor shell | WS-0, WS-1 | Click-to-edit smoke |
| **WS-3** Products & Checkout (publish → Orders OS) | ⚪ PLANNED | `products`, Stripe, `orders.js` | WS-0, payments | Web order in board |
| **WS-4** Inventory & Holiday Command Center | ⚪ PLANNED | `inventory-freshness.js`, holiday module | WS-3, inventory API | Low-stock hide smoke |
| **WS-5** SEO, Analytics, Publishing | ⚪ PLANNED | `SEO_FOUNDATION.md`, domains | WS-0 versioning | Pre-publish checklist |
| **WS-6** Import, Mobile Editor, Advanced Lily | ⚪ PLANNED | Import adapter, mobile UI | WS-2–WS-5 | Import does not auto-publish |
| RC1 Instant Website (precursor) | ✅ COMPLETE | `bloom-instant-website.js`, `instant-website.js` | Shop settings | Preview site |
| RC1 Website editor shell | 🟡 IN PROGRESS | `website-editor-ui.js` | RC1 projects | Section reorder |
| Public storefront | ✅ COMPLETE | `storefront-public.js` | Tenant slug | `/store/{slug}` |
| Per-shop sitemap | 🟡 IN PROGRESS | `storefront-public.js?action=sitemap` | Published pages | Fetch sitemap XML |
| Four quick-start entry paths | ⚪ PLANNED | WS-1 UI | WS-1 | Lily / Design / Import / Blank |
| Pre-publish checklist | ⚪ PLANNED | WS-5 | All WS phases | Block publish on critical gaps |
| Holiday Command Center | ⚪ PLANNED | WS-4 | New module | Single control center |

---

## Reports

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Reports page + KPI export | ✅ COMPLETE | `reportsPage`, `finance.js` | Order/payment data | Open Reports |
| Production reporting | ⚪ PLANNED | — | Order history migration | — |

---

## Staff

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Clock in/out (PIN) | ✅ COMPLETE | `staff.js`, scrypt hash | Staff PIN set | Clock in from staff page |
| Public list: name + clock only | ✅ COMPLETE | `staff.js` strips sensitive fields | — | GET staff → no pay rate |
| Private file (payroll, contact) | ✅ COMPLETE | PIN-gated `OPEN_FILE` action | Server enforcement | Open file without PIN → 403 |
| PIN reauth for sensitive edits | ✅ COMPLETE | Rate-limited PIN verify | — | Wrong PIN blocked |

---

## AI

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Honest Lily/Rose status | 🟡 IN PROGRESS | `ai-status.js`, `_shared/ai-status.js`, `refreshAiStatus()` | Cloudflare or OpenAI env | Settings → AI dashboard |
| Cloudflare Workers AI path | ✅ COMPLETE | `ai-assistant.js` | `CLOUDFLARE_*` env | Chat when configured |
| Local Ollama fallback (dev) | ✅ COMPLETE | `local-ai-bridge/` | Local bridge | Dev only |
| Voice wake words | 🔒 FUTURE | Flag `VOICE_WAKE: false` | Browser STT | Disabled in prod |
| Lily platform drawer | 🟡 IN PROGRESS | `lily-platform.js`, `lily-ai.js` | Optional DB tables | Open Lily drawer |
| No sensitive data in AI logs | ✅ COMPLETE | Structured logs truncate | — | Review function logs |

---

## Owner Admin

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Platform Command Center | ✅ COMPLETE | `admin-command-center.js` | `super_admin` role | `/admin` console |
| Shop onboarding | ✅ COMPLETE | `complete-florist-onboarding.js` | — | New shop signup |
| Bootstrap lock after first owner | ✅ COMPLETE | `admin-bootstrap.js` | `PLATFORM_BOOTSTRAP_SECRET` | Second bootstrap blocked |

---

## Security

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| RLS on shop tables | ✅ COMPLETE | Supabase migrations | `is_shop_member()` | Cross-tenant query fails |
| Server-side validation | ✅ COMPLETE | `_shared/validation.js` | — | Invalid payload → 400 |
| Rate limits (auth, PIN) | ✅ COMPLETE | `_shared/rate-limit.js` | — | Brute force blocked |
| Feature flags for unfinished modules | 🟡 IN PROGRESS | `_shared/feature-flags.js` | Env overrides | GET production-health |
| Session refresh | ✅ COMPLETE | `auth-refresh.js`, `refreshSessionIfNeeded()` in `app.js` | — | Token refresh before expiry |
| MFA for platform admins | 🔒 FUTURE | — | Supabase MFA | — |

See `docs/SECURITY_REVIEW.md` for full findings.

---

## Reliability

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Global error boundary (React) | 🟡 IN PROGRESS | `frontend/src/components/ErrorBoundary.tsx` | — | Throw in dev → fallback |
| Friendly error states (production) | ✅ COMPLETE | `BloomLaunchPolish.errorState` | — | Simulate API failure |
| Production health endpoint | 🟡 IN PROGRESS | `production-health.js`, `health.js` | — | GET `/.netlify/functions/production-health` |
| AI failure isolation | 🟡 IN PROGRESS | `refreshAiStatus` graceful degrade | — | AI offline → POS works |
| Payment failure isolation | ✅ COMPLETE | Stripe cancel path | — | Cancel checkout |

See `docs/RELIABILITY_AND_RECOVERY.md`.

---

## Legal / Compliance

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Static legal pages (marketing) | ✅ COMPLETE | `public/legal/*` | — | Visit `/legal/privacy/` |
| In-app acceptance architecture | ⚪ PLANNED | `docs/LEGAL_COMPLIANCE_ARCHITECTURE.md` | DB tables + UI | — |
| Attorney review gate | ⛔ BLOCKED | — | Licensed attorney | Do not ship clauses without review |

---

## Marketplace

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Browse + checkout | 🟡 IN PROGRESS | `marketplace*.js` | Verification + Stripe | Flag `MARKETPLACE_PUBLIC` |
| Seller verification | 🟡 IN PROGRESS | `marketplace-verification*.js` | Migrations | Submit verification |

---

## Wholesalers

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Wholesale seller dashboard | 🟡 IN PROGRESS | `wholesale-seller-dashboard.js`, `marketplace-seller.js` | Flag `WHOLESALE_SELLER` | Open wholesale page |

---

## Weddings

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Wedding project workflows | 🔒 FUTURE | — | Orders foundation stable | — |

---

## Marketing

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| BloomShot / social assets | ✅ COMPLETE | `bloomshotPage` | — | Generate asset |
| Email campaigns | 🔒 FUTURE | — | Transactional email domain | — |

---

## University / Community

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Florist learning community | 🔒 FUTURE | — | Content platform | — |

---

## Design System v1.0 (permanent UI reference)

**Authority:** `docs/FLORISYN_DESIGN_SYSTEM.md` — tokens, components, layout patterns.

| Area | Status | Verification |
|------|--------|--------------|
| Color role tokens (primary, success, warning, …) | 🟡 IN PROGRESS | `:root` in `public/styles.css`; semantic badges |
| Typography scale (Display → Caption) | 🟡 IN PROGRESS | Today hero + page headings |
| Spacing scale (4–64px) | 🟡 IN PROGRESS | Card/panel padding audit |
| Radius + shadow tokens | 🟡 IN PROGRESS | `--radius`, `--shadow-soft` consistent |
| Motion tokens (150/250/350ms) | 🟡 IN PROGRESS | Hover transitions; reduced-motion |
| Core components catalog | 🟡 IN PROGRESS | Buttons, cards, badges, kanban, dialogs |
| Layout patterns (dashboard, kanban, wizard, …) | 🟡 IN PROGRESS | Shell matches documented patterns |
| Orders card standard (project, not spreadsheet) | 🟡 IN PROGRESS | Kanban + order dialog fields |
| Design review checklist (8 items) | ✅ COMPLETE | Documented — enforce before feature ship |
| React `ui/` parity with production | 🟡 IN PROGRESS | `button`, `card`, `surface-card` |

---

## Ecosystem Portals (permanent portal architecture)

**Authority:** `docs/FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` — one OS, three role-based portals.

| Portal | Status | Verification |
|--------|--------|--------------|
| Portal 1 — Florist (Today, Orders, POS, CRM, …) | 🟡 IN PROGRESS | Production SPA; Today anchor preserved |
| Portal 2 — Wholesaler (catalog, fulfillment, …) | 🟡 IN PROGRESS | `wholesaleSellerPage`, verification, seller dashboard |
| Portal 3 — Platform Owner (tenants, flags, health) | 🟡 IN PROGRESS | `admin.html`, `admin-command-center.js` |
| Shared customer / product / inventory models | 🟡 IN PROGRESS | No duplicate domain tables in new work |
| Shared order / payment / delivery models | 🟡 IN PROGRESS | Wholesale orders use marketplace tables linked to core |
| Shared auth + design + AI platform | 🟡 IN PROGRESS | Supabase Auth; Experience Standard; Lily/Rose |
| Four-question feature gate (portal, services, SSOT, standards) | ✅ COMPLETE | Documented — enforce before feature ship |

---

## Experience Standard (permanent UX constitution)

**Authority:** `docs/FLORISYN_EXPERIENCE_STANDARD.md` — all screens must feel like one application.

| Area | Status | Verification |
|------|--------|--------------|
| Core principles (beauty, one purpose, obvious actions) | 🟡 IN PROGRESS | UX review against Today page anchor |
| Typography & color hierarchy | 🟡 IN PROGRESS | Consistent status colors across orders/deliveries |
| Premium cards (shadows, padding, imagery) | 🟡 IN PROGRESS | Order board + customer cards visual QA |
| Buttons (one primary, danger confirmation) | 🟡 IN PROGRESS | Payment Center + delete flows |
| Motion (smooth, non-blocking) | 🟡 IN PROGRESS | `prefers-reduced-motion`; no save-blocking animation |
| Desktop layout (nav, top bar, content, panel) | 🟡 IN PROGRESS | Production SPA shell |
| Mobile layout (bottom nav, thumb-friendly) | 🟡 IN PROGRESS | Mobile smoke in stacked release test |
| Orders standard (floral project, not spreadsheet) | 🟡 IN PROGRESS | Order card shows photo, timeline, payment |
| Forms (autofill, early validation, preserve work) | 🟡 IN PROGRESS | Order + customer forms |
| Empty states (purpose + first action) | 🟡 IN PROGRESS | No bare "No data" screens |
| Errors (what happened + how to fix + preserve work) | 🟡 IN PROGRESS | `BloomLaunchPolish.errorState` patterns |
| Accessibility (keyboard, focus, contrast, SR) | 🟡 IN PROGRESS | Manual a11y pass on critical flows |
| Florist emotion (welcoming, calm under peaks) | 🟡 IN PROGRESS | Owner sign-off on holiday-season UX |
| Seven-question completion gate | ✅ COMPLETE | Documented — enforce before feature ship |

---

## Gold Standard (permanent product principles)

**Authority:** `docs/FLORISYN_GOLD_STANDARD.md` — applies to all modules and releases.

| Principle | Status | Verification |
|-----------|--------|--------------|
| §1 Single Source of Truth | 🟡 IN PROGRESS | No duplicate domain tables; Website Studio consumes existing APIs |
| §2 Florist First | 🟡 IN PROGRESS | UX review on order/payment flows; plain-language labels |
| §3 Calm Software | 🟡 IN PROGRESS | Today + Orders board visual QA under load |
| §4 Explainable AI | 🟡 IN PROGRESS | Lily draft → preview → publish; `ai-status.js` honest state |
| §5 One Click Rule | 🟡 IN PROGRESS | Smoke: create order, payment, print card ≤2 clicks from home |
| §6 Recovery Before Speed | 🟡 IN PROGRESS | Order status history, audit_events, rollback runbooks |
| §7 Holiday Mode | 🔒 FUTURE | WS-4 Holiday Command Center; production board peak UX |
| §8 Delight | 🟡 IN PROGRESS | Empty states, typography, publish celebration (Website Studio) |
| §9 Performance Budget | 🟡 IN PROGRESS | <2s load target; Lighthouse on production SPA |
| §10 Future Ecosystem | 🟡 IN PROGRESS | Shared APIs for POS, Website, Marketplace, Lily, Rose |

---

## Deployment gate (Foundation v1)

| Step | Status | Verification |
|------|--------|--------------|
| All docs committed | 🟡 IN PROGRESS | This checklist + 8 doc files |
| Tests 396/396 pass | ✅ COMPLETE | `npm test` | — | Full suite green |
| Migration reviewed | ✅ COMPLETE | `20260730_foundation_daily_loop_v1.sql` |
| Owner applies migration | ⛔ BLOCKED | Supabase credentials required |
| Single controlled Netlify deploy | ⛔ BLOCKED | Owner approval — **do not auto-deploy** |

---

*Maintained with Foundation v1 + Daily Loop v2/v3 + Website Studio + Gold Standard + Experience Standard + Design System v1.0 + Ecosystem Portals (2026-07-30).*
