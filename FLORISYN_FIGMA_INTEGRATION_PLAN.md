# Florisyn — Figma Design Integration Plan

**Status:** Planning deliverable for review. **No implementation code written; nothing deployed.** Branch `cursor/florisyn-figma-integration` created from `main` (latest stable). Awaiting plan review before broad implementation (per your instruction).

**Goal:** Recreate the approved Figma design accurately inside the existing Florisyn app while preserving and reconnecting all working functionality. Frontend/UX work only — backend (Supabase/Stripe/auth/orders/customers/inventory/staff/payments) is preserved.

---

## 0. Blocking dependency — the Figma source is not available to me

I do not have the approved Figma file/link/exported frames or specs. Pixel-accurate recreation and a true "missing screens/states" gap analysis require it. **To proceed with implementation I need one of:**
- A Figma share link (view access) to the approved file, or
- Exported frames (PNG/SVG) + a spec export (Dev Mode / tokens JSON) for each screen and state.

Everything below (inventory, component structure, preserve/rewire lists, phases, testing/deploy plans) is grounded in the **actual current codebase** and is valid without the Figma; the Figma is required to finalize visual specifics and confirm the "missing screens" list (§7).

---

## 1. Existing application inventory

**Stack:** static SPA in `public/` (vanilla JS, no framework/bundler) + ~40 Netlify Functions in `netlify/functions/` + Supabase (Postgres + Auth) + Stripe. Served via `netlify.toml` (`/api/* → /.netlify/functions/:splat`, plus `/login`, `/signup`, `/admin`, SPA `/*`).

### 1.1 Routes
- **App SPA:** `public/index.html` + `public/app.js` (all authenticated app pages render here; classic `<script defer>`).
- **Auth pages:** `/login` (`login.html`+`login.js`), `/signup` (`signup.html`+`signup.js`), `/admin` (`admin.html`+`admin.js`), onboarding (`onboarding.html`+`onboarding.js`, module).
- **Marketing/static:** `public/company/{about,become-a-florist,careers,difference,feedback,services}`, `public/legal/{privacy,terms,accessibility,cookies,unsubscribe}`, `public/help/{,chat,contact,faqs,order-delivery}`, `public/sitemap`.
- **CSS in use:** `styles.css`, `signup.css`, `admin.css`, `onboarding.css`, `public-site.css`, `platform-v21.1.css`, `polish-v20.2.css`, `polish-v20.4.css` (layered "polish" sheets — candidates for consolidation into the new token system).

### 1.2 SPA pages (nav `data-page` → section `id`)
`dashboardPage, ordersPage, paymentsPage (POS/payments), customersPage, inventoryPage, productsPage, libraryPage, deliveriesPage, staffPage, expensesPage, reportsPage, invoicesPage, marketplacePage, websitePage, bloomshotPage, storesPage, settingsPage`.
Page loaders (in `app.js` `loadPage` map): `loadCustomers, loadOrders, loadDeliveries, loadInventory, loadProducts, loadBloomShot, loadWebsite, renderLibrary, loadExpenses, loadReports, loadStaff, loadMarketplace, loadStores, loadSettings, loadInvoices`, plus `loadDashboard`, POS (`loadPosTiles/renderPosTiles`).

### 1.3 Forms & dialogs (all in `index.html`, driven by `app.js`)
Forms: `customerForm, orderForm, inventoryForm, inventoryScanForm, productForm, libraryDesignForm, marketplaceForm, deliveryForm, expenseForm, staffForm, settingsForm, storeForm, tileEditForm, tileManagerForm, quickPriceForm, websiteForm`.
Dialogs/modals: `customerDialog, orderDialog, inventoryDialog, inventoryScanDialog, productDialog, libraryDesignDialog, marketplaceDialog, deliveryDialog, expenseDialog, staffDialog, storeDialog, tileEditDialog, tileManagerDialog, quickPriceDialog, receiptDialog, savedQuotesDialog` (native `<dialog>`).

### 1.4 Backend functions (API) — grouped
- **Auth/session:** `auth-signup`, `auth-login`, `auth-refresh`, `onboarding-status`, `complete-onboarding`, `complete-florist-onboarding` (dead — undefined RPC), `tenant-config`, `stores`.
- **Core data:** `dashboard`, `orders`, `customers`, `customer-insights`, `inventory`, `inventory-scan` (disabled 409), `products`, `recipes`, `deliveries`, `expenses`, `finance`, `staff`, `settings`, `suppliers`, `marketplace`.
- **Payments/billing:** `payments`, `create-checkout`, `verify-checkout`, `create-subscription-checkout`, `stripe-connect`, `marketplace-checkout`, `stripe-order-webhook`, `stripe-subscription-webhook`.
- **AI:** `ai-assistant`, `ai-context`, `content-helper` (Lily/Rose; local bridge fallback).
- **Platform admin:** `admin-console`, `admin-bootstrap`, `platform-settings`, `_shared/platform-admin.js`.
- **Utilities/shared:** `route-distance`, `health`, `_shared/{http,supabase,saas,post-stripe-payment,platform-admin}.js`.

### 1.5 Supabase & Stripe call surfaces
- Supabase: all data functions via service-role client (`_shared/supabase.js currentUser`, `_shared/saas.js authenticatedUser`); auth via GoTrue REST (signup/login/refresh); Storage (`expense-receipts`).
- Stripe: order checkout (`create-checkout`→`verify-checkout`/`stripe-order-webhook`, idempotent RPC `post_order_payment`), subscriptions (`create-subscription-checkout`/`stripe-subscription-webhook`), Connect (`stripe-connect`), marketplace (`marketplace-checkout`).

### 1.6 Permissions
- Tenant scoping: `currentUser()` derives `shopId` from `shop_members` (server-side; browser never supplies `shop_id`). Role gates via `requireRoles` on `settings`, `staff`, `finance`, `payments`, `create-checkout`. Platform admin via `platform_admins`.
- Stage 2A (executed on rehearsal DB) added `staff_time_entries` RLS + `staff.user_id` + `shop_members.can_view_all_timesheets` + indexes.

### 1.7 Working vs broken/incomplete
- **Working (verified in earlier turns):** auth signup/login → shop provisioning; `/api/health`; dashboard/orders/customers/inventory/finance/staff data; POS order create; Stripe order-payment path (idempotent); expenses w/ receipts.
- **Broken / incomplete:**
  - **SPA shell does not render on `main`** — `app.js` calls `setAuthMode(false)` on load referencing `#signupFields`/`#createIntro` removed in v22 → `TypeError` before `showApp()`, blank authenticated app. **The new app shell (Phase A) replaces this init path and fixes it.**
  - Emoji/placeholder floral graphics + external Pexels hotlinks (product/library/marketplace/POS/website) — violate brand standard; replaced by the image component (rule #12; see `FLORISYN_IMAGE_SYSTEM.md`).
  - `complete-florist-onboarding` → undefined `complete_florist_onboarding` RPC (dead path; `complete-onboarding` is the working one).
  - `ai-context` references non-existent `inventory_items`/`scheduled_date` (silent failure).
  - `inventory-scan` disabled (returns 409).
  - POS tile images stored as base64 in `localStorage` (no optimization).

---

## 2. Figma-to-code mapping (template — to be finalized against the Figma)

Format: **Figma screen/component → existing route/component → backend data/function → status.** Status legend: **Preserve** (logic reused), **Rewire** (connect existing feature to new UI), **Pending** (feature absent → mark pending or hide, per rule #6), **New-UI** (visual rebuild only).

| Figma screen/component | Existing route/component | Backend data/function | Status |
|---|---|---|---|
| App shell / sidebar / top nav | `index.html` layout + `app.js` `showApp/showPage` | session (`bloom_session`), `stores`, `tenant-config` | Rewire + New-UI |
| Mobile navigation | (none — desktop-only nav today) | — | New-UI |
| Dashboard | `dashboardPage` / `loadDashboard` | `GET /api/dashboard` | Preserve + New-UI |
| POS | `paymentsPage` + product pad + `quickPriceForm` + POS cart | `orders`, `payments`, `create-checkout`, `verify-checkout`, `customers`, `products`, `settings` | Preserve + Rewire |
| Orders | `ordersPage` / `loadOrders` + `orderForm`/`orderDialog` | `GET/POST/PATCH /api/orders`, `deliveries`, `recipes` | Preserve + New-UI |
| Order detail / receipt | `receiptDialog` / `openReceipt` | order data, `verify-checkout` | Preserve + New-UI |
| Customers | `customersPage` / `loadCustomers` + `customerForm` | `customers`, `customer-insights` | Preserve + New-UI |
| Inventory | `inventoryPage` / `loadInventory` + `inventoryForm` | `inventory` (+`inventory-scan` pending) | Preserve + New-UI |
| Products & recipes | `productsPage`/`libraryPage` + `productForm`/`libraryDesignForm` | `products`, `recipes` | Preserve + New-UI |
| Deliveries | `deliveriesPage` / `loadDeliveries` + `deliveryForm` | `deliveries`, `route-distance` | Preserve + New-UI |
| Staff / payroll | `staffPage` / `loadStaff` + `staffForm` | `staff` (+ Stage 2A `staff_time_entries` model) | Preserve + New-UI |
| Reports / finance | `reportsPage`/`invoicesPage` / `loadReports` | `finance`, `invoices` (via orders) | Preserve + New-UI |
| Settings | `settingsPage` / `loadSettings` + `settingsForm` | `settings`, `stores`, `stripe-connect` | Preserve + New-UI |
| Lily & Rose (AI) | `bloomshotPage` + assistant UI | `ai-assistant`, `ai-context`, `content-helper`, local bridge | Rewire (+ fix `ai-context` bug) |
| Website & marketing | `websitePage` / `loadWebsite` + `websiteForm`; static marketing site | `settings` (site fields), Netlify Forms | Preserve + New-UI |
| Marketplace | `marketplacePage` / `loadMarketplace` + `marketplaceForm` | `marketplace`, `marketplace-checkout` | Preserve + New-UI |
| Stores / shop switch | `storesPage` / `loadStores` + `storeForm` | `stores` | Preserve + New-UI |
| Subscription/billing | (in settings/onboarding) | `create-subscription-checkout`, `shop_subscriptions` | Preserve + Rewire |
| Admin console | `/admin` (`admin.html`/`admin.js`) | `admin-console`, `platform-settings` | Separate track (New-UI later) |
| Auth: login/signup/onboarding | `/login`,`/signup`, onboarding | `auth-*`, `complete-onboarding` | Rewire + New-UI |

Each row will be expanded per Figma frame (with exact component names + states) once the Figma is available.

---

## 3. Proposed component & token structure

Consistent with the existing **no-bundler** stack: native ES modules + CSS custom properties (no framework introduced — keeps deploys simple and avoids a major rewrite, per the engineering standard). If a framework/bundler is desired, that is a separate architectural decision requiring approval.

```
public/design/
  tokens.css              # design tokens (CSS custom properties)
  base.css                # resets, typography, focus-visible, a11y defaults
  components.css          # component styles (BEM-ish, token-driven)
  tokens.js               # JS mirror of tokens needed in logic (breakpoints, z-index)
  components/
    appShell.js  sidebar.js  topNav.js  mobileNav.js  pageHeader.js
    button.js  input.js  select.js  searchField.js  modal.js
    productCard.js  orderCard.js  customerCard.js  table.js
    statusBadge.js  notification.js  emptyState.js  loadingState.js  errorState.js
    image.js              # real-photography <picture> component (no emoji; per FLORISYN_IMAGE_SYSTEM.md)
  index.js                # barrel export of the component library
public/pages/             # per-page render modules that consume components + existing data logic
  dashboard.js  pos.js  orders.js  customers.js  inventory.js  deliveries.js
  staff.js  reports.js  settings.js  ai.js  website.js  marketplace.js  stores.js
public/app-core/          # preserved data/logic extracted from app.js (api client, session, POS cart, order builder, payments)
```

**Design tokens (rule #8):** `--color-*` (brand/surfaces/text/status), `--font-*`/type scale, `--space-*`, `--radius-*`, `--shadow-*`, `--bp-*` (breakpoints), `--control-h-*`/`--field-*` (form sizing), `--card-*` (card sizing), `--z-*` (z-index layers). Exact values pulled from the Figma tokens.

**Shared components (rule #7):** app shell, sidebar, top nav, mobile nav, page headers, buttons, inputs, selects, search fields, modals, product/order/customer cards, tables, status badges, notifications, empty/loading/error states — each a small factory (`create…()` returning a DOM node) + CSS, with documented props, states (default/hover/focus/disabled/loading), and a11y baked in.

**Interactivity contract (rules #5/#6):** every control is (a) wired to an existing feature, (b) rendered with a visible **"Pending"** treatment (disabled + tooltip/badge) when its feature isn't implemented, or (c) omitted until implemented. No dead buttons.

---

## 4. Functions that can be preserved UNCHANGED

- **All `netlify/functions/**`** (backend) — no changes needed for the visual integration. (Stage 2B authorization work is tracked separately and is out of scope here.)
- **Do NOT modify** the approved Stage 2A migration files (`supabase/stage2a/*`) (rule #2).
- **Frontend data/logic to extract & reuse verbatim** into `app-core/` (behavior preserved, only import site changes): `api()` client + `Authorization` header handling; session read/save (`bloom_session`); `loadDashboard` compute; `loadOrders/loadCustomers/loadInventory/loadDeliveries/loadStaff/loadExpenses/loadReports/loadProducts/loadMarketplace/loadStores/loadSettings` data-fetch bodies; POS cart (`posCart`, `savePosCart`, `cartTotals`, `checkoutPosCart`), order builder math, `recordLocalPayment`, `finishStripeReturn`, `calculateRoute`, receipt content builder, freshness/format helpers (`money/esc/dateText/inventoryFreshness`).

## 5. Functions needing REWIRING (logic kept, DOM/markup rebuilt)

- **App init/shell:** replace the broken `setAuthMode`-based bootstrap with the new `appShell` mount (fixes the blank-SPA bug); wire `showPage`/routing to the new sidebar/top-nav/mobile-nav.
- **Rendering functions** that currently emit inline HTML strings into legacy markup: `productCard`, `renderLibrary`, `loadMarketplace`, `renderPosTiles/renderTileEditor`, `renderCustomers`, dashboard tiles, order/customer/inventory lists → re-target to the shared components (and use the image component instead of emoji).
- **Auth screens:** `/login`, `/signup`, onboarding wired to the new inputs/buttons/validation + existing `auth-*`/`complete-onboarding`.
- **POS (rule #16):** rebuild the POS surface on shared components while preserving customer search + create, products/categories, current order, recipient info, delivery info, card message, order notes, tax %, deposits (where permitted), Stripe payments, receipt/invoice actions, inventory deductions, and save/edit — all via existing `orders`/`payments`/`create-checkout`/`customers`/`products`/`settings`.
- **AI (Lily/Rose):** new UI + fix `ai-context` (`inventory_items`→`inventory`, `scheduled_date`→`delivery_date`) so context loads (small, reviewed change).

## 6. Tenant isolation, auth, accessibility, responsiveness, imagery
- **Tenant isolation & auth (rules #9):** unchanged — server derives `shopId`; the frontend keeps sending only the bearer token; no `shop_id` from the browser. Shop switching stays via `stores` (validated membership).
- **Responsive (rule #10):** token breakpoints (desktop/laptop/tablet/mobile); the app shell collapses the sidebar into `mobileNav`; card/table components have responsive variants (tables → stacked cards on mobile).
- **Accessibility (rule #11):** semantic HTML, `<label>`/`aria-*`, keyboard nav, visible `:focus-visible`, WCAG-AA contrast tokens, ≥44px touch targets, native `<dialog>` focus-trap.
- **Imagery (rule #12):** real floral photography only via the image component; emoji/clip-art/placeholder floral graphics removed (aligns with `FLORISYN_IMAGE_SYSTEM.md`). Licensed stock sourcing is a dependency there.

---

## 7. Missing Figma screens / states (to confirm against the Figma)
Cannot be finalized without the Figma. Based on the app's needs, please confirm the Figma includes designs for each of these (flagging any not present as gaps to resolve before building that area):
- Global: mobile navigation, empty/loading/error states for every list, toast/notification, "photo pending" card state, "feature pending" control state.
- POS: customer-search results & create-customer inline, recipient/delivery/card-message panels, tax/deposit UI, payment method selection, receipt/invoice view.
- Orders/Customers/Inventory/Deliveries/Staff: list + detail + create/edit modal + empty/loading/error.
- Staff/payroll: owner/manager "view all" vs employee "own only" views (reflecting Stage 2A privacy).
- Reports, Settings (incl. Stripe Connect + subscription/billing), Lily/Rose, Website/marketing editor, Marketplace, Stores/shop-switch, Admin console.
- Auth: login, signup (plan selection), onboarding wizard, error/validation states.

---

## 8. Implementation phases (rule #15 order)
Each phase is a small, reviewable PR; no broad implementation until this plan is approved and the Figma is provided.
- **A. Global app shell + design system** — tokens, base/components CSS, component library, app shell/sidebar/top-nav/mobile-nav, `app-core/` extraction; fixes the blank-SPA bug. (Foundation for all pages.)
- **B. Dashboard** → **C. POS** (rule #16 checklist) → **D. Orders** → **E. Customers** → **F. Inventory** → **G. Deliveries** → **H. Staff/payroll** → **I. Reports** → **J. Settings** → **K. Lily & Rose** → **L. Website & marketing**.
- Cross-cutting (auth screens, marketplace, stores, admin) sequenced alongside the nearest relevant phase.

## 9. Testing plan
- **Local only (rules #17/#18):** run via `netlify dev --offline` + local Supabase (see `AGENTS.md`); no production.
- **Per phase:** functional wiring verified end-to-end against real local Supabase/Stripe-test data (no mock data, rule #4); screenshots/preview for approval (rule #18).
- **Responsive:** verify desktop/laptop/tablet/mobile at token breakpoints (manual + `computerUse` captures).
- **Accessibility:** keyboard-only pass, visible focus, axe/Lighthouse a11y checks, contrast verification, touch-target sizing.
- **Regression:** confirm preserved features still work (auth, POS order+payment, order/customer/inventory CRUD, shop switching, tenant isolation — a member of shop A cannot see shop B).
- **Visual review:** each phase compared against the Figma frames.

## 10. Deployment plan
- **No production deploys during initial integration** (rule #17).
- Work validated locally; **bundle approved phases into as few Netlify deployments as possible** (rule #19) — e.g., a single deploy after the design system + first tranche of pages is approved, rather than per-phase deploys.
- Since these are static frontend + (minor) function tweaks, a deploy ships `public/` + any touched functions together; group approvals to minimize deployment credits.

---

## 11. What I need to start implementation
1. **Figma access** (link or exported frames + token/spec export) — hard dependency for §2 finalization, §7 gap analysis, and accurate visuals.
2. Confirmation of the **no-framework, token+ES-module** approach in §3 (or a decision to introduce a bundler/framework — larger scope).
3. Approval of the phase order and of the small, in-scope fixes flagged (blank-SPA bootstrap, `ai-context` identifiers, emoji→image component).
4. Confirmation on licensed floral photography source (from `FLORISYN_IMAGE_SYSTEM.md`) for any stock imagery.

No broad implementation will begin until this plan is reviewed and approved.

---

# PART 2 — Figma inspection results (visual source of truth)

The approved Figma Make preview was opened and inspected in a browser (all routes navigated; screenshots captured). §0's blocking dependency is resolved. Screenshots: `figma_dashboard.webp`, `figma_pos.webp`, `figma_orders.webp`, `figma_inventory.webp`, `figma_reports.webp`, `figma_settings.webp`, `figma_order_detail_drawer.webp` (in the walkthrough). Note: exact token values should still be confirmed via Figma **Dev Mode**; values below are measured-by-eye starting points.

> The preview's top bar shows "Sign up with email"/"Continue with Google" — that is **Figma Make preview chrome**, not part of the Florisyn app design; excluded from the build. Please confirm.

## 2.1 Figma screen inventory
Persistent **left sidebar** grouped into sections, plus a top bar (search "Search anything…", help, user profile "Ashley Monroe" bottom-left). Nav items (in order):
- **Overview:** Dashboard
- **Operations:** Orders, POS, Deliveries, **Calendar**
- **Customers:** Customers, Invoices
- **Flowers:** Inventory
- **Business:** Reports, **Marketing**
- **Team:** Employees
- **Intelligence:** Lily AI, Rose AI
- **Bottom:** Settings

Screens documented (14 + a right-side **Order Detail drawer**): Dashboard (Lily card + 6 stat cards + recent orders + inventory alerts), Orders (filter pills by status, table, Lily insight banner), POS (product catalog grid w/ category photo chips + right-hand order panel: customer search, occasion, recipient, card message, pickup/delivery toggle, notes, items, totals, actions), Deliveries (route timeline cards), Calendar (month view w/ events), Customers (cards w/ stats + call/email), Invoices (summary cards + list + send), Inventory (photo cards w/ stock bar, category badges, cost/retail/margin, reorder/price), Reports (line/donut/bar charts + KPI cards), Marketing (campaigns list + templates), Employees/Team (member cards), Lily AI (chat), Rose AI (insight cards), Settings (shop details + notification toggles).

## 2.2 Observed design tokens (starting values — confirm in Dev Mode)
- **Colors:** primary sage green `~#7A9B76`; light green surface `~#E8F1E6`; page bg `~#FAFAF8`; card `#FFFFFF`; input bg `~#F8F6F3`; text primary `~#2C2C2C`, secondary `~#8B8B8B`, tertiary `~#B8B8B8`; status: green (success/ready/delivered), orange (in-progress/low), red (critical/none), blue (pending), purple (accent).
- **Typography:** serif headings (Playfair Display-like), sans-serif body (Inter-like). Confirm exact families/weights/sizes from Dev Mode.
- **Radius:** buttons ~8px, cards ~12px, inputs ~6px, badges/avatars pill/round.
- **Shadows:** soft, low-opacity (≈ `0 2px 8px rgba(0,0,0,.08)`).
- **Spacing:** generous; card-based grids (2–3 cols) collapsing to 1 col on small screens.

## 2.3 Component inventory (from Figma → maps to §3 component list)
App shell + grouped sidebar + top bar; page headers (title + subtitle + primary action); buttons (primary green, secondary outlined, icon buttons); inputs; selects ("Sort: …"); search fields; **filter pills/tabs with counts**; cards (stat, product, customer, delivery-timeline, insight, employee); tables (Orders, Invoices); status badges (color-coded); **right-side drawer** (Order Detail) as the modal pattern; alert/insight banners (Lily); avatars (initials, pastel); charts (line/donut/bar) on Reports; toggle switches (Settings). Empty/loading/error/permission states were not all visible → §2.5.

## 2.4 Refined Figma → code mapping (screen → route/component → data → status + states)

| Figma screen | Existing route/component | Backend data/functions | Status | States to add |
|---|---|---|---|---|
| Dashboard | `dashboardPage`/`loadDashboard` | `GET /api/dashboard` | Preserve + New-UI | loading, error, empty |
| Orders (+filter pills) | `ordersPage`/`loadOrders` + `orderDialog` | `orders`, `deliveries`, `recipes` | Preserve + New-UI | loading, empty, error, per-status filters |
| Order Detail drawer | `receiptDialog`/order render | order data, `verify-checkout` | Rewire (drawer pattern) | loading, error |
| POS | `paymentsPage` + product pad + `quickPriceForm` | `orders`,`payments`,`create-checkout`,`verify-checkout`,`customers`,`products`,`settings` | Preserve + Rewire | empty cart, payment pending/success/error |
| Deliveries (timeline) | `deliveriesPage`/`loadDeliveries` | `deliveries`, `route-distance` | Preserve + New-UI | empty, error, no-route |
| **Calendar** | *(none today)* | derive from `orders.delivery_date`/`deliveries` | **New-UI (no new backend)** | empty, loading |
| Customers | `customersPage`/`loadCustomers` | `customers`, `customer-insights` | Preserve + New-UI | empty, loading, error |
| Invoices | `invoicesPage`/`loadInvoices` | orders/`payments` | Preserve + New-UI | empty, past-due, error |
| Inventory | `inventoryPage`/`loadInventory` | `inventory` (+`inventory-scan` pending) | Preserve + New-UI | empty, low/critical, error |
| Reports (charts) | `reportsPage`/`loadReports` | `finance` | Preserve + New-UI (add charts) | loading, empty |
| Marketing | `websitePage`/`loadWebsite` + static site | `settings`, Netlify Forms | Preserve + New-UI | draft/scheduled/sent |
| Employees/Team | `staffPage`/`loadStaff` + `staffForm` | `staff`, Stage 2A `staff_time_entries` (owner/mgr vs self) | Preserve + New-UI | **permission-denied** (payroll), empty |
| Lily AI (chat) | `bloomshotPage` + assistant | `ai-assistant`,`ai-context`,`content-helper`,local bridge | Rewire (+fix `ai-context`) | loading, offline (AI down) |
| Rose AI (insights) | *(part of bloomshot)* | `ai-assistant`/`content-helper` | Rewire | loading, empty |
| Settings | `settingsPage`/`loadSettings` + `stripe-connect` | `settings`,`stores`,`stripe-connect`,subscriptions | Preserve + New-UI | saving, error, permission |

## 2.5 Missing screens / states (to resolve before/within the relevant phase)
- **Calendar** exists in Figma but has **no backend** today → build from existing `orders.delivery_date`/`deliveries` (no schema change); confirm scope.
- **Not shown in the Figma** but present in the app (decision needed — see §2.6): Products & Recipe builder, Floral Library, Marketplace (wholesale), multi-store/shop switcher, onboarding wizard, subscription/billing UI, admin console.
- **States generally absent from the preview** and required (rule #4 in prompt): loading skeletons, error states, empty states, success/confirmation toasts, and **permission-denied** states (critical for Team/payroll per Stage 2A). These will be designed as shared components and applied everywhere.
- **Responsive/mobile nav** wasn't demonstrable in the preview → the mobile navigation (collapsed sidebar/hamburger + drawer) will be built to match the desktop system; confirm any mobile frames exist in Figma.

## 2.6 Existing features WITHOUT a Figma screen (must be preserved — rule #5)
Products/recipes, Floral Library, Marketplace, Stores/shop-switch, onboarding, subscription/billing, admin console. Options per item (need your call): (a) design later (keep functional, lightly styled with the new tokens in the interim), or (b) fold into an existing Figma screen (e.g., Products under Inventory/POS). **None will be removed or turned into dead controls.**

## 2.7 Accessibility plan (rule #11)
Semantic landmarks (`<nav> <main> <header>`), every control labelled (`<label for>`/`aria-label`), keyboard operability for nav/menus/drawer/dialogs (native `<dialog>` focus trap, ESC to close), visible `:focus-visible` rings in a brand token, WCAG-AA contrast (verify the sage-green-on-white and badge colors meet 4.5:1 for text / 3:1 for large/UI), ≥44px touch targets, charts get text/table alternatives, images get meaningful `alt`. Automated checks (axe/Lighthouse) + a keyboard-only manual pass per screen.

## 2.8 Preview plan (rules #10, #18)
Local only: `netlify dev --offline` + local Supabase (per `AGENTS.md`). Per phase I'll capture `computerUse` screenshots/short video at desktop/laptop/tablet/mobile widths and post them here for approval before moving on. Each screen compared side-by-side with its Figma frame. Regression checks confirm preserved features still work against real local data (no mock data, rule #6).

## 2.9 Deployment plan (minimize Netlify usage — rule #19)
- **No production deploys during integration** (rule #10/#17); all review via local previews.
- Batch approved phases and deploy in **one Netlify build** per approved tranche (e.g., design system + shell + first pages together), not per-page. Because the frontend is static + esbuild-bundled functions, a single deploy ships everything touched.
- Target **≤ 2–3 total deploys** for the whole integration: (1) after design-system + shell + Dashboard/POS/Orders are approved, (2) after the remaining pages, (3) a final polish pass — adjustable to your credit budget.

## 2.10 Open questions for approval
1. Confirm the no-framework approach (CSS tokens + native ES-module components) vs introducing a bundler/framework.
2. Confirm the top-bar auth buttons are preview chrome to exclude.
3. Decide handling for the §2.6 features not in the Figma (design later vs fold-in).
4. Confirm Calendar scope (derive from orders/deliveries, no new backend).
5. Provide Figma **Dev Mode** access or a token export so exact colors/type/spacing match precisely.
6. Approve the small in-scope fixes: blank-SPA bootstrap, `ai-context` identifiers, emoji→image component.

No broad implementation will begin until this plan is approved.
