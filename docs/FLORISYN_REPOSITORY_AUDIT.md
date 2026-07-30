# Florisyn / Bloom Repository Audit

**Audit date:** 2026-07-30  
**Repository path:** `/workspace`  
**Branch context:** `build/florisyn-foundation-v1` (Foundation v1 daily loop work in progress)

---

## Executive summary

Florisyn is a **dual-stack florist operating system**:

1. **Production UI** — Vanilla JS SPA in `public/` (~704-line `public/app.js` plus ~25 feature modules), deployed via Netlify with `publish = "public"`.
2. **Next-gen UI (preview)** — React 19 + Vite + Tailwind 4 in `frontend/`, **not wired into Netlify publish**. Uses static sample data only.

Backend is **63 Netlify serverless functions** in `netlify/functions/` backed by **Supabase Postgres** (45 SQL files, RLS via `is_shop_member()`). Auth is Supabase password grant with JWT stored in `localStorage` as `bloom_session`.

---

## 1. Framework versions

### Root `package.json`

| Field | Value |
|-------|-------|
| Name | `bloom-florist-operating-system` |
| Version | `1.0.0-rc.1` |
| Node | `>=20` |
| Dependencies | `@supabase/supabase-js` ^2.49.8, `stripe` ^17.7.0 |

### `frontend/package.json`

| Package | Version |
|---------|---------|
| react / react-dom | ^19.2.7 |
| react-router-dom | ^7.18.2 |
| vite | ^8.1.1 |
| typescript | ~6.0.2 |
| tailwindcss | ^4.3.3 (@tailwindcss/vite ^4.3.3) |
| framer-motion | ^12.43.0 |
| recharts | ^3.10.1 |
| lucide-react | ^1.27.0 |
| oxlint | ^1.71.0 (lint) |

### `local-ai-bridge/package.json`

| Field | Value |
|-------|-------|
| Name | `bloom-local-ai-bridge` |
| Version | 17.3.0 |
| Runtime | Node ESM, no npm dependencies |

---

## 2. Build system

### Netlify (`netlify.toml`)

```toml
[build]
  publish = "public"          # NOT frontend/dist
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"
```

**Redirects:**

- `/api/*` → `/.netlify/functions/:splat`
- Auth/marketing HTML: `/login`, `/signup`, `/admin`, `/forgot-password`, `/verify-email`, `/reset-password` → respective `.html` files
- Storefront SPA: `/store/*`, `/storefront-preview/*` → `/storefront/index.html`
- Catch-all `/*` → `/index.html` (serves **`public/index.html`**, the vanilla app)

**Implication:** `npm run frontend:build` produces `frontend/dist/` but Netlify does **not** deploy it unless the publish path or build command is changed.

### Root scripts (`package.json`)

| Script | Command |
|--------|---------|
| `check` | `node scripts/check.mjs` — syntax-checks all `.js` files recursively |
| `test` | `node --test tests/*.test.js` |
| `test:foundation` | `node --test tests/foundation-v1.test.js` |
| `frontend:dev` | Vite dev server (port 5173) |
| `frontend:build` | `tsc -b && vite build` |
| `ai:install` / `ai:start` | Local Ollama bridge |

### Frontend scripts

| Script | Command |
|--------|---------|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `lint` | `oxlint` + floral asset verification scripts |

---

## 3. Environment variables

### Documented in `.env.example`

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Client-safe key |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | Server-side admin client |
| `SUPABASE_PUBLISHABLE_KEY` | Optional anon replacement |
| `STRIPE_SECRET_KEY` | Stripe API |
| `SITE_URL` | Canonical site URL for redirects/checkout |
| `OPENAI_API_KEY` | Listed but **not used** by `netlify/functions/ai-assistant.js` (Cloudflare preferred) |
| `OPENAI_MODEL` | Default `gpt-4.1-mini` (unused in primary AI path) |
| `BLOOM_MARKETPLACE_FEE_PERCENT` | Default 5% marketplace fee |
| `CLOUDFLARE_ACCOUNT_ID` | Workers AI |
| `CLOUDFLARE_AI_API_TOKEN` | Workers AI |
| `CLOUDFLARE_AI_MODEL` | Default `@cf/meta/llama-3.1-8b-instruct-fast` |

### Additional vars referenced in code (not in `.env.example`)

| Variable | Where used |
|----------|------------|
| `STRIPE_ORDER_WEBHOOK_SECRET` | `stripe-order-webhook.js` |
| `STRIPE_WEBHOOK_SECRET` | `production.js` ENV_GROUPS |
| `STRIPE_CONNECT_CLIENT_ID` | `stripe-connect.js`, production config |
| `STRIPE_PRICE_STARTER/PROFESSIONAL/PREMIUM` | `shop-billing.js`, `create-subscription-checkout.js` |
| `GOOGLE_MAPS_API_KEY` | `route-distance.js` |
| `URL` | Netlify deploy URL fallback |
| `PLATFORM_BOOTSTRAP_SECRET` | `admin-bootstrap.js` |
| `FLORISYN_ALLOW_OPEN_BOOTSTRAP` | Dev-only open bootstrap |
| `FLORISYN_FLAG_<NAME>` | Feature flags override |
| `MARKETPLACE_TAX_ENCRYPTION_KEY` | `marketplace-verification.js` |
| `MARKETPLACE_VERIFICATION_*` | TTL, email webhook |
| `BLOOM_EMAIL_PROVIDER`, `BLOOM_EMAIL_WEBHOOK_URL` | Payment ops health |
| `BLOOM_SMS_PROVIDER`, `BLOOM_SMS_WEBHOOK_URL` | Payment ops health |
| `RESEND_API_KEY` | Documented in `docs/production/ENVIRONMENT.md` |
| `OLLAMA_URL`, `BLOOM_AI_HOST`, `BLOOM_AI_PORT`, `BLOOM_AI_MODEL` | `local-ai-bridge/server.js` |
| `BLOOM_ALLOWED_ORIGINS` | Local AI bridge CORS |

### Health probe

`GET /.netlify/functions/production-health` aggregates config from `netlify/functions/_shared/production.js`, AI status, feature flags, and security summary.

---

## 4. Supabase patterns

### Client factories (`netlify/functions/_shared/supabase.js`)

| Function | Key | RLS |
|----------|-----|-----|
| `userClient(token)` | Anon/publishable + Bearer JWT | **Yes** |
| `currentUser(event)` | Member JWT; resolves `shopId` via `shop_members` + `profiles.default_shop_id` | **Yes** |
| `admin()` | Service role / secret key | **Bypasses RLS** |
| `adminIfConfigured()` | Optional service role (login audit) | Bypasses RLS |
| `publicSettings()` | URL + anon key for auth endpoints | N/A |

Phase 2A A2: **`currentUser()` never upgrades to service role**. Tier-3 routes call `admin()` explicitly.

### Duplicate admin path

`netlify/functions/_shared/saas.js` also exports `admin()` and `authenticatedUser()` — used by `admin-console.js` and platform admin flows.

### Migrations

| Location | Count |
|----------|-------|
| `supabase/migrations/*.sql` | 25 |
| `supabase/migration_*.sql` (root) | 19 |
| `supabase/schema.sql` | 1 (foundation baseline) |
| **Total SQL files** | **45** |

Notable recent migrations:

- `20260730_foundation_daily_loop_v1.sql` — order status expansion, `order_status_history`, delivery proof fields, inventory freshness columns
- `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` — staff time clock RLS
- Payment hub, marketplace, Lily AI platform, subscription center, instant websites (20260728 batch)

### RLS model

Core helper in `supabase/schema.sql`:

```sql
create or replace function public.is_shop_member(target_shop uuid)
returns boolean ... security definer
```

Policies on `shops`, `profiles`, `shop_members`, `customers`, `orders`, `inventory`, `expenses` use `is_shop_member(shop_id)`. Additional tables (payment hub, marketplace, Lily conversations, order status history) add policies in dated migrations — **~68 policy/RLS references** across SQL files.

### Graceful degradation

Many functions catch missing-table errors (e.g. `lily-ai.js`, `payment-link-public.js`) and continue with reduced functionality until migrations are applied.

---

## 5. Auth / session handling

### Flow

1. **Login:** `public/login.js` → `POST /.netlify/functions/auth-login` → Supabase `/auth/v1/token?grant_type=password`
2. **Storage:** `localStorage.bloom_session` = `{ accessToken, refreshToken, user }`
3. **API calls:** `public/app.js` `api()` attaches `Authorization: Bearer ${accessToken}`
4. **Server validation:** `currentUser()` calls `client.auth.getUser(token)` and verifies active `shop_members` row
5. **Logout:** Clears `bloom_session`, redirects to `/login`

### Auth Netlify functions

| Function | Role |
|----------|------|
| `auth-login.js` | Password grant, rate limit 30/min, optional login audit |
| `auth-signup.js` | Registration |
| `auth-forgot-password.js` / `auth-reset-password.js` | Recovery |
| `auth-refresh.js` | Refresh token exchange |

### Gaps

- **`auth-refresh` is not called from `public/app.js`** — sessions expire without silent refresh; users must re-login.
- **No httpOnly cookies** — tokens in `localStorage` are XSS-exposed.
- **Shop switching:** `stores.js` PATCH updates `profiles.default_shop_id`; subsequent `currentUser()` picks new shop.

### Platform admin auth

Separate path via `platformAdmin()` in `_shared/platform-admin.js` — requires active row in `platform_admins`. Mutations often require `super_admin` role.

---

## 6. Tenant isolation

### Server-side

1. **`currentUser(event)`** returns `shopId` from membership; all Tier-1 handlers filter `.eq("shop_id", shopId)`.
2. **`requireRowShopId(row, shopId)`** in `_shared/shop-scope.js` — 403 if row belongs to another shop.
3. **Stripe checkout** — `verify-checkout.js` rejects sessions where `metadata.bloom_shop_id !== shopId`.
4. **RLS** — Postgres policies enforce `is_shop_member(shop_id)` on member-scoped tables.

### Client-side

- Shop switcher in header loads stores via `stores.js` GET; only member shops returned.
- No client-side shop_id override in API payloads for core CRUD (server derives from JWT).

### Service-role exceptions (by design)

| Function | Why service role |
|----------|------------------|
| `storefront-public.js` | Anonymous storefront visitors |
| `payment-link-public.js` | Pay-by-token links |
| `customer-portal.js` | Portal token auth |
| `stripe-order-webhook.js` | Stripe signature, no user JWT |

These bypass RLS server-side; must validate tokens/signatures strictly.

---

## 7. Stripe integration

### Netlify function entry points

| File | Purpose |
|------|---------|
| `create-checkout.js` | Order payment Checkout Session |
| `verify-checkout.js` | Post-redirect session verify + post payment |
| `stripe-order-webhook.js` | Order payment webhooks |
| `stripe-subscription-webhook.js` | Subscription events |
| `stripe-connect.js` | Connect onboarding |
| `create-subscription-checkout.js` | SaaS plan checkout |
| `shop-billing.js` | Shop subscription management |
| `payment-hub.js` | Unified payment center (Stripe + manual) |
| `payment-link-public.js` | Public pay links |
| `marketplace-checkout.js` | Marketplace purchases + platform fee |
| `storefront-public.js` | Customer-facing storefront checkout |

### Shared modules

| File | Purpose |
|------|---------|
| `_shared/post-stripe-payment.js` | Apply Stripe payment to order |
| `_shared/post-stripe-payment-link.js` | Payment link fulfillment |
| `_shared/payment-hub-core.js` | Hub orchestration |
| `_shared/payment-hub-providers.js` | Provider selection (Stripe default) |
| `_shared/payment-saved-charge.js` | Saved card charges |
| `_shared/recurring-billing-execute.js` | Recurring billing |

### Client UI

- `public/payment-hub-ui.js`, `public/payment-link-ui.js`, `public/shop-billing-ui.js`
- `public/storefront/storefront.js` — customer checkout
- `public/app.js` — POS payment center, Stripe return handling (`finishStripeReturn`)

### Behavior when unconfigured

Functions return **503** with florist-friendly messages; manual/cash payments remain available via `payments.js` / payment hub.

---

## 8. AI integration (Lily / Rose)

### Personas

| Persona | Role | Primary paths |
|---------|------|---------------|
| **Lily** | Creative florist assistant | Dashboard card, AI Studio, Lily platform drawer, content helpers, Photo Studio |
| **Rose** | Business advisor | Dashboard briefing, reports persona, wake-word target |

Both share the same **`smartAi()`** pipeline in `public/app.js` with different system prompts/persona prefix.

### Request routing (`public/app.js` → `smartAi`)

```
1. POST /.netlify/functions/ai-assistant  (Cloudflare Workers AI)
2. Fallback: http://127.0.0.1:11435/chat or /generate  (local-ai-bridge → Ollama)
```

### Server endpoints

| Endpoint | File | Behavior |
|----------|------|----------|
| `ai-assistant` | `netlify/functions/ai-assistant.js` | Cloudflare AI; requires `currentUser()`; blocks image/base64 in context |
| `ai-status` | `netlify/functions/ai-status.js` | Public GET; honest online/offline state |
| `ai-context` | `netlify/functions/ai-context.js` | Shop-scoped context for assistants |
| `lily-ai` | `netlify/functions/lily-ai.js` | Rule-based intent engine (`lily-ai-engine.js`); permissions by role; optional DB persistence |
| `assistant-tts` | `assistant-tts.js` | TTS (feature-flagged) |
| `content-helper.js` | Marketing copy helper |

### Lily platform UI

`public/lily-platform.js` — floating drawer, localStorage conversations, calls `lily-ai` API for coach/intent actions.

### Local AI bridge

`local-ai-bridge/server.js` — Ollama proxy on port 11435; CORS allows localhost and `*.netlify.app`.

### Env vars (AI)

| Priority | Vars |
|----------|------|
| Production (online) | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` |
| Limited | `OPENAI_API_KEY`, remote `OLLAMA_URL` |
| Local dev | Ollama + bridge (`npm run ai:start`) |

### Feature flags (`_shared/feature-flags.js`)

- `VOICE_WAKE: false` — "Hey Lily / Hey Rose" off by default
- `LILY_SERVER_PERSISTENCE: true`
- `INVENTORY_AI_INTAKE: false`, `INVENTORY_RECIPE_DEDUCTIONS: false`

### React frontend Lily

`frontend/src/components/today/lily-recommendation.tsx` — **static sample copy** from `today-sample.ts`, no API.

---

## 9. Routes / pages

### Production app (`public/index.html` + `showPage()`)

Single HTML shell; pages toggled via `.page.active` CSS. Sidebar `data-page` targets:

| Page ID | Feature |
|---------|---------|
| `dashboardPage` | POS / command center |
| `ordersPage` | Order board + production workflow |
| `deliveriesPage` | Delivery kanban + manifest print |
| `customersPage` | CRM |
| `inventoryPage` | Inventory + scan |
| `invoicesPage` | Invoices |
| `paymentsPage` | Payment Center (Payment Hub) |
| `aiStudioPage` | Lily AI Studio |
| `productsPage` | Products & recipe builder |
| `bloomshotPage` | Photo Studio |
| `websitePage` | Website Studio |
| `libraryPage` | Floral Library |
| `expensesPage` | Expenses + receipt upload |
| `reportsPage` | Reports + Rose persona |
| `staffPage` | Staff + time clock |
| `marketplacePage` | Wholesale marketplace |
| `wholesaleSellerPage` | Seller dashboard |
| `storesPage` | Multi-location |
| `subscriptionPage` | Subscription Center |
| `ecosystemPage` | Business OS |
| `settingsPage` | Branding + billing |

### Static / public HTML (outside main app)

| Path | File |
|------|------|
| `/login` | `public/login.html` |
| `/signup` | `public/signup.html` |
| `/admin` | `public/admin.html` |
| `/onboarding` | `public/onboarding.html` |
| `/pay` | `public/pay.html` |
| `/store/*` | `public/storefront/index.html` |
| `/help/*`, `/legal/*`, `/company/*` | Marketing/support pages |

### React frontend (`frontend/src/routes/AppRouter.tsx`)

| Route | Status |
|-------|--------|
| `/` | Redirect → `/today` |
| `/today` | **Implemented** — sample data (`today-sample.ts`) |
| `/orders` | **Implemented** — sample data (`orders-sample.ts`) |
| `/pos`, `/inventory`, `/customers`, `/payments` | Placeholder pages |
| `*` | Redirect → `/today` |

**Not deployed** via current Netlify config.

---

## 10. Design tokens / CSS

### Dual design systems (intentional split)

#### A. Production (`public/`)

Cascading stylesheets loaded in `public/index.html` (17+ CSS files):

| File | Era / purpose |
|------|---------------|
| `styles.css` | Base layout, POS, dialogs |
| `florisyn-brand.css`, `florisyn-founder-1.0.css`, `florisyn-rc2.2-founder-polish.css` | Florisyn rebrand |
| `bloom-v23.css`, `bloom-rc1-luxury.css`, `bloom-rc2-design-system.css`, `bloom-rc2.1-polish.css`, etc. | Bloom RC layering |
| `lily-platform.css`, `payment-hub.css`, `business-ecosystem.css` | Feature modules |

CSS variables in `styles.css`:

```css
:root {
  --brand-primary: #8f3f68;
  --app-background: #f8f3f6;
  --sidebar-color: #30232d;
  --header-color: #ffffff;
}
```

Runtime branding via `applyBranding()` in `public/app.js` sets `--brand-primary`, `--app-background`, etc. from shop settings.

#### B. React frontend (`frontend/src/index.css`)

Tailwind v4 `@theme` tokens:

- Fonts: `DM Sans`, `Cormorant Garamond`
- Colors: `warm-cream`, `blush-*`, `sage-*`, `charcoal`, `florisyn-border`
- Shadows: `shadow-card`, `shadow-elevated`
- Dark mode via `.dark` class + `ThemeProvider`

Floristry photos: `frontend/src/lib/floristry-photo-library.ts` + `frontend/public/assets/floristry/`.

---

## 11. Tests — count and structure

| Metric | Value |
|--------|-------|
| Test files | **38** (`tests/*.test.js`) |
| Total test cases | **322** |
| Pass / fail | **321 / 1** |
| Total lines | ~3,082 |
| Runner | Node built-in `node:test` |
| No Jest/Vitest/Playwright | — |

### Structure

Tests are **module-focused integration/unit tests** that import shared Netlify modules and assert on static files:

| Area | Example files |
|------|---------------|
| Foundation v1 | `foundation-v1.test.js`, `florisyn-foundation.test.js` |
| Payments | `payment-hub.test.js`, `payments-live-wiring.test.js`, `bloom-b1-*.test.js` |
| RC releases | `bloom-rc1.test.js`, `bloom-rc2.test.js`, `bloom-rc2.1.test.js` |
| Marketplace | `marketplace-verification*.test.js`, `wholesale-seller.test.js` |
| AI | `lily-ai-platform.test.js`, `ai-text.test.js`, `assistant-voice.test.js` |
| Branding | `florisyn-founder-1.0.test.js`, `bloom-auth-branding.test.js` |
| Admin | `admin-command-center.test.js`, `platform-admin.test.js` |
| Supabase env | `supabase-env.test.js` |

### Known failure

```
not ok 157 - sidebar invoices and payments are plain nav buttons without extra wrappers
```

(in `tests/florisyn-rc2.2-founder-polish.test.js` or similar RC polish suite)

### Frontend tests

**None.** React app has lint/verify scripts only (`verify-floral-asset-consumption.mjs`, `verify-floral-catalog-files.mjs`).

---

## 12. Working vs partial vs broken features

Status traced through client → Netlify function → Supabase.

| Feature | Status | Evidence |
|---------|--------|----------|
| Florist login/signup | **Working** | `auth-login.js`, `login.js`, Supabase password grant |
| Session refresh | **Partial / broken** | `auth-refresh.js` exists; client never calls it |
| POS + cart + quotes | **Working** | `public/app.js` local state + `orders.js` POST |
| Orders CRUD + status board | **Working** | `orders.js`, RLS; UI uses legacy `NEW` label while server normalizes to `PENDING` |
| Customers, inventory, expenses | **Working** | Dedicated functions; `loadPage` wiring |
| Dashboard / profit intelligence | **Working** | `dashboard.js` → KPIs, use-first, daily special |
| Deliveries + route distance | **Partial** | Works if `GOOGLE_MAPS_API_KEY` set; else degraded |
| Payment Center / Stripe checkout | **Working when configured** | `payment-hub.js`, `create-checkout.js`; 503 without keys |
| Manual/cash payments | **Working** | `payments.js`, local record in app |
| Invoices + receipts | **Working** | Client-rendered; email via `mailto:` |
| Website Studio + preview | **Working** | `settings.js` / instant website modules |
| Floral Library | **Working** | Static `LIBRARY` in app + `floral-library.js` API |
| Staff + PIN time clock | **Working** | `staff.js` scrypt PIN hash, rate limits |
| Marketplace browse/checkout | **Partial** | Gated on verification; needs Stripe + migrations |
| Wholesale seller dashboard | **Partial** | UI in `wholesale-seller-dashboard.js`; server `marketplace-seller.js` |
| Subscription Center | **Partial** | Requires Stripe price IDs + `shop-billing.js` |
| Business Ecosystem | **Partial** | `business-ecosystem.js` + UI module |
| Lily AI chat (cloud) | **Partial** | Needs Cloudflare env; falls back to local bridge |
| Lily AI platform drawer | **Partial** | Rule-based `lily-ai.js`; DB tables optional |
| Rose briefing | **Working** | Template text from dashboard data + TTS |
| Voice wake ("Hey Lily/Rose") | **Disabled by default** | `VOICE_WAKE: false`; browser SpeechRecognition |
| Inventory AI scan | **Flag off** | `INVENTORY_AI_INTAKE: false` |
| Platform admin / Command Center | **Working** | `admin-console.js`, `admin-command-center.js` |
| Storefront (public) | **Working** | `storefront-public.js` + `public/storefront/` |
| React `/today`, `/orders` | **UI only** | Sample data; no backend |
| React POS/inventory/customers/payments | **Not started** | Placeholder routes |
| Netlify → React deploy | **Not wired** | `publish = "public"` |

### Order status vocabulary drift

- **Server** (`_shared/order-status.js`): `NEW` → `PENDING`
- **Client** (`public/app.js` `ORDER_FLOW`): still displays `NEW` as first column
- **Foundation migration**: expands allowed DB statuses; history table added

---

## 13. Security risks

| Risk | Severity | Detail |
|------|----------|--------|
| JWT in `localStorage` | Medium | XSS could steal `bloom_session`; no httpOnly cookies |
| No client token refresh | Medium | Long sessions fail silently; users may work with stale tokens until 401 |
| Service role on public endpoints | Medium (by design) | `payment-link-public`, `storefront-public` — must validate tokens/signatures; any bug is cross-tenant |
| `FLORISYN_ALLOW_OPEN_BOOTSTRAP` | High if enabled in prod | Documented as dev-only; allows admin bootstrap without secret |
| Platform bootstrap secret | High | `PLATFORM_BOOTSTRAP_SECRET` must be set before prod deploy |
| Staff PIN in transit | Low | Hashed server-side (scrypt); rate limited; not returned in API responses |
| Local AI bridge CORS | Low | Allows `*.netlify.app` and localhost — appropriate for dev |
| Admin search SQL | Low | `admin-console.js` uses `.or()` ilike — parameterized via Supabase client |
| Missing marketplace tax encryption key | Medium | `MARKETPLACE_TAX_ENCRYPTION_KEY` optional — tax data may be stored unencrypted if unset |
| Duplicate / stale root files | Low | Root `app.js`, `ai-assistant.js` may confuse contributors |
| OPENAI in `.env.example` but unused | Low | Misleading ops docs; no key leakage path in primary AI |
| 17 CSS files on main app | Low | Performance surface, not auth |

Positive controls: rate limits on login, PIN attempts, structured audit logging, `safePublicError()`, feature flags for unfinished modules, Closed Beta `super_admin` gate on HQ mutations, shop-scoped Stripe metadata validation.

---

## 14. Dead code / duplicates

| Item | Path | Notes |
|------|------|-------|
| Stale root app | `/app.js` (616 lines) | Older copy of `public/app.js` (704 lines); missing cloud AI status refresh, payment features |
| Stale AI assistant | `/ai-assistant.js` | Duplicate of `netlify/functions/ai-assistant.js` |
| React build artifact | `frontend/dist/` | Built but not published |
| Dual Supabase admin | `_shared/supabase.js` vs `_shared/saas.js` | Both export `admin()` |
| Bloom + Florisyn naming | Throughout | `bloom_session`, `BloomPaymentHub`, CSS `bloom-*` alongside `florisyn-*` |
| Legacy migration files | `supabase/migration_v*.sql` at root | Parallel to `supabase/migrations/` — apply order documented in `docs/production/MIGRATION-ORDER.md` |
| `frontend/src/components/layout/AppShell.tsx` | Unused? | `FloristShell.tsx` is used in router |
| Hardcoded "Hi Ashley!" | `public/index.html` lily card | Not dynamic |
| `login.js` loaded on main index | `public/index.html` line 264 | Loaded on app page though auth redirect goes to `/login` |

---

## Appendix A — Netlify function inventory (63 handlers)

`admin-bootstrap`, `admin-command-center`, `admin-console`, `ai-assistant`, `ai-context`, `ai-status`, `assistant-tts`, `auth-forgot-password`, `auth-login`, `auth-refresh`, `auth-reset-password`, `auth-signup`, `beta-feedback`, `business-ecosystem`, `client-errors`, `complete-florist-onboarding`, `complete-onboarding`, `content-helper`, `create-checkout`, `create-subscription-checkout`, `customer-insights`, `customer-portal`, `customers`, `dashboard`, `deliveries`, `expenses`, `finance`, `floral-library`, `floral-library-admin`, `health`, `instant-website`, `inventory`, `inventory-scan`, `lily-ai`, `marketplace`, `marketplace-catalog`, `marketplace-checkout`, `marketplace-seller`, `marketplace-verification`, `marketplace-verification-admin`, `marketplace-verification-review`, `onboarding-status`, `orders`, `payment-hub`, `payment-link-public`, `payments`, `platform-settings`, `production-health`, `products`, `recipes`, `route-distance`, `settings`, `shop-billing`, `staff`, `storefront-public`, `stores`, `stripe-connect`, `stripe-order-webhook`, `stripe-subscription-webhook`, `subscription-center`, `tenant-config`, `verify-checkout`, plus shared modules in `_shared/`.

---

## Appendix B — Recommended follow-ups

1. Wire `auth-refresh` into `public/app.js` before token expiry.
2. Decide React migration path: change Netlify publish or proxy `/app-v2/*` to `frontend/dist`.
3. Align order status UI (`NEW` vs `PENDING`) with `_shared/order-status.js`.
4. Remove or symlink root `app.js` and `ai-assistant.js` to prevent drift.
5. Fix failing RC2.2 sidebar test or update HTML to match spec.
6. Add frontend API integration or clearly gate behind `REACT_ORDERS_PREVIEW` env flag in UI.

---

*Generated by repository audit — 2026-07-30.*
