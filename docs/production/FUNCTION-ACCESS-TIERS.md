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
   Any query/provider failure is caught and re-thrown as a redacted 503 — provider details never
   enter logs (only a fixed Florisyn event and categorical code).
5. Require a matching row with `active = true`, and an allowed role. When `allowedRoles` is
   missing or empty, access **fails closed to `super_admin` only** (Founding Beta, P0-02 R1) —
   there is no "any active admin" fallback. `super_admin` is always permitted as an explicit
   override when a narrower role list is supplied.
6. Only after authorization succeeds is the service-role client handed to downstream platform
   administration code — which is why every Tier 2 handler below can safely query across all
   shops (orders, subscriptions, marketplace listings, etc.) without shop-scoped RLS blocking it.

All four platform-admin handlers use the shared `platformAdminErrorResponse()` boundary
(P0-02 R1): 500-level responses never include raw database/provider messages; logs contain
only a stable event name, HTTP status, optional correlation ID, and a Florisyn categorical code.

| Function | Access (Founding Beta) | Mutations | Notes |
|----------|------------------------|-----------|-------|
| `admin-console` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | All POST actions → `requireSuperAdmin(admin)` immediately before write | |
| `admin-command-center` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | All POST actions → `requireSuperAdmin(admin)` immediately before write | |
| `marketplace-verification-admin` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | Verification review (POST) → `requireSuperAdmin(admin)` | |
| `floral-library-admin` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | Import/approve/duplicate-review → `requireSuperAdmin(admin)` before each write | |

Every mutation branch above calls `requireSuperAdmin(admin)` immediately before its database
write — an explicit, greppable/testable role gate, not an implicit assumption. Broader
administrator capabilities (`support`, `designer`, `billing`) are deferred until a separate RBAC
matrix receives Founder approval.

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

## Closed Beta role model (Founding Beta — P0-02 R1)

- **`super_admin`**: only role that may access any current platform-admin endpoint or mutation.
- Other roles (`support`, `billing`, `designer`, …) may exist in DB but **cannot receive the
  service-role client** until a separate RBAC matrix receives Founder approval.
