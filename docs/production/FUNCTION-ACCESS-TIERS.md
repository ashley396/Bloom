# Netlify function access tiers

Florisyn routes fall into four tiers. New functions must declare their tier in PR notes.

## Tier 0 — Public (unauthenticated)

No shop JWT. May use rate limits and tokens in URL/body.

| Function | Notes |
|----------|--------|
| `auth-login`, `auth-signup`, `auth-forgot-password`, `auth-reset-password`, `auth-refresh` | Auth flows; rate limited where noted |
| `admin-bootstrap` | **GET** `ownerExists` only; **POST** first owner once, then **409 forever**; POST requires `PLATFORM_BOOTSTRAP_SECRET` when configured |
| `health`, `production-health` | Status probes |
| `storefront-public` | Public shop sites; uses service role server-side |
| `payment-link-public` | Pay-by-token; service role |
| `customer-portal` | Portal token + service role |
| `platform-settings` | Degraded public metrics |

## Tier 1 — Shop member (Bearer JWT + `currentUser`)

Florist app. Queries scoped by `shop_id` and role. **A2:** `currentUser()` always uses the member JWT + anon/publishable key (RLS); it does not upgrade to the service role.

All standard CRUD: `orders`, `customers`, `inventory`, `dashboard`, `settings`, `payment-hub`, `marketplace`, etc.

## Tier 2 — Platform admin (`platformAdmin`)

Florisyn HQ. Requires row in `platform_admins` with `active = true`.

### `platformAdmin()` is a server authorization boundary, not a browser database-access mechanism

`public.platform_admins` has **no grants or RLS policies** for `anon`/`authenticated`
(see P0-01 / P0-01 R1) — a browser JWT can never read it directly, by design. `platformAdmin()`
(`netlify/functions/_shared/platform-admin.js`) is the only path that is allowed to consult it,
and it does so with a **service-role client that is created only after the caller's bearer token
has been verified** (P0-02):

1. Verify the bearer token via `authenticatedUser()` — 401 on missing/invalid/expired token.
   No server client exists at this point.
2. Use only the verified `user.id` from Supabase Auth. An administrator identity is **never**
   accepted from the request body, query parameters, other headers, `user_metadata`, or
   `raw_user_meta_data`.
3. Only after authentication succeeds, create the secure service-role client via `admin()`.
   A missing service-role key fails safely with a 503 before any database call.
4. Query `platform_admins` for exactly that verified `user.id`, using the service-role client.
   Any query/provider failure is caught and re-thrown as a redacted 503 — the raw cause is
   logged server-side only, never returned to the caller.
5. Require a matching row with `active = true`, and (when `allowedRoles` is given) an allowed
   role. `super_admin` is always permitted as an explicit override.
6. Only after authorization succeeds is the service-role client handed to downstream platform
   administration code — which is why every Tier 2 handler below can safely query across all
   shops (orders, subscriptions, marketplace listings, etc.) without shop-scoped RLS blocking it.

| Function | Reads | Mutations | Notes |
|----------|-------|-----------|-------|
| `admin-console` | Any active admin (`overview`, `shops`, `shop`) | `save-platform-settings`, `save-config`, `update-shop`, `update-subscription` → `requireSuperAdmin`; `mark-alerts-read` → `requireAnyActiveAdmin` (explicit, low-risk) | |
| `admin-command-center` | Any active admin (dashboard, users, marketplace, support, subscriptions, announcements, feature-flags, analytics, system-health, audit-log, etc.) | `suspend-user`, `reactivate-user`, `marketplace-listing`, `create-announcement`, `save-feature-flags` → `requireSuperAdmin`; `password-reset-workflow`, `support-update`, `lily-query`, `record-ai-request` → `requireAnyActiveAdmin` (explicit, low-risk audit/analytics/ticket writes) | |
| `marketplace-verification-admin` | Any active admin | Verification review (single POST action) → `requireSuperAdmin` | |
| `floral-library-admin` | `super_admin` only | `super_admin` only | `platformAdmin(event, ["super_admin"])` gates the **entire endpoint**, including reads — one explicit gate covers every action (Closed Beta) |

Every mutation branch above calls `requireSuperAdmin(admin)` or `requireAnyActiveAdmin(admin)`
immediately before its database write — an explicit, greppable/testable role gate, not an
implicit assumption. `requireAnyActiveAdmin` is a no-op once `platformAdmin()` has already
verified an active row; its purpose is to make each mutation's authorization decision explicit
rather than relying only on the handler-entry check.

Reads (dashboard, lists) remain available to any active platform admin, except where a function
explicitly restricts the whole endpoint to `super_admin` as noted above.

## Tier 3 — Service role (`admin()`)

Server-only. Never expose keys to the browser.

| Function | Notes |
|----------|--------|
| `admin-bootstrap` | First-time platform owner creation |
| `stripe-order-webhook`, `stripe-subscription-webhook` | Stripe signatures required |
| `client-errors` | Error ingestion |
| `payment-link-public`, `storefront-public`, `customer-portal` | Public entry with server trust |

Webhooks and bootstrap are the only Tier 3 entrypoints that are not also gated by Tier 2 checks.

## Environment

See [ENVIRONMENT.md](./ENVIRONMENT.md) for `PLATFORM_BOOTSTRAP_SECRET` and `FLORISYN_ALLOW_OPEN_BOOTSTRAP`.

## Closed Beta role model

- **`super_admin`**: first platform owner; full HQ mutations.
- Other roles (`support`, `billing`, …) may exist in DB but **high-impact POST actions require `super_admin`** until a later phase expands RBAC.
