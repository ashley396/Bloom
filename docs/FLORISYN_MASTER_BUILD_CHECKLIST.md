# Florisyn Master Build Checklist

**Last updated:** 2026-07-30  
**Branch:** `cursor/florisyn-daily-loop-v2-7317` (Daily Loop v2 on top of Foundation v1)  
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
| React Orders preview | 🟡 IN PROGRESS | `frontend/src/pages/OrdersPage.tsx` | Sample data only | `npm run frontend:dev` |
| Order audit log (full entity diff) | ⚪ PLANNED | `audit_events` table | Migration + handler wiring | Inspect audit_events |
| Align UI `NEW` column with `PENDING` | ⚪ PLANNED | `public/app.js` ORDER_FLOW | — | Board shows Pending not NEW |

---

## Customers

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| CRUD + search | ✅ COMPLETE | `customers.js`, `public/app.js` | RLS | Add/edit customer |
| Buyer vs recipient separation | ✅ COMPLETE | Order + customer models | — | Delivery to different recipient |
| Order history on customer | ✅ COMPLETE | Customer detail panel | Orders linked | Open customer record |
| House account flag | 🟡 IN PROGRESS | Migration column `is_house_account` | Migration applied | PATCH customer |
| Soft delete | 🟡 IN PROGRESS | Migration column `deleted_at` | Migration + UI filter | Delete → hidden not purged |
| Contact preferences | 🟡 IN PROGRESS | Migration `contact_preferences` jsonb | Migration + UI | Save prefs |
| Duplicate prevention | ⚪ PLANNED | Dedup on phone/email | Server validation | Attempt duplicate phone |
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
| Freshness / use-first dates | 🟡 IN PROGRESS | `received_at`, `use_by` columns | Migration | Dashboard use-first |
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
| Proof photo / signature | 🟡 IN PROGRESS | Migration columns on `deliveries` | Storage + UI | ⛔ UI not wired yet |
| Maps abstraction + fallback | 🟡 IN PROGRESS | `route-distance.js`, flag `DELIVERY_MAPS` | API key or graceful degrade | Remove maps key → message |

---

## Website

| Item | Status | Files | Dependencies | Verification |
|------|--------|-------|--------------|--------------|
| Instant Website Studio | ✅ COMPLETE | `instant-website.js`, `bloom-instant-website.js` | Shop settings | Preview site |
| Public storefront | ✅ COMPLETE | `storefront-public.js`, `public/storefront/` | Tenant slug | Visit `/store/{slug}` |
| SEO per-shop sitemap | 🟡 IN PROGRESS | `storefront-public.js?action=sitemap` | Published pages | Fetch sitemap XML |
| Landing page architecture | ⚪ PLANNED | `docs/SEO_FOUNDATION.md` | Content templates | — |

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

## Deployment gate (Foundation v1)

| Step | Status | Verification |
|------|--------|--------------|
| All docs committed | 🟡 IN PROGRESS | This checklist + 8 doc files |
| Tests 321/322 pass | 🟡 IN PROGRESS | 1 pre-existing RC polish failure |
| Migration reviewed | ✅ COMPLETE | `20260730_foundation_daily_loop_v1.sql` |
| Owner applies migration | ⛔ BLOCKED | Supabase credentials required |
| Single controlled Netlify deploy | ⛔ BLOCKED | Owner approval — **do not auto-deploy** |

---

*Maintained with Foundation v1 batch — update status as items ship.*
