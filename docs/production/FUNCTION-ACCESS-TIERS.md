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

Florist app. Queries scoped by `shop_id` and role.

All standard CRUD: `orders`, `customers`, `inventory`, `dashboard`, `settings`, `payment-hub`, `marketplace`, etc.

## Tier 2 — Platform admin (`platformAdmin`)

Florisyn HQ. Requires row in `platform_admins` with `active = true`.

| Function | Notes |
|----------|--------|
| `admin-console` | Shop remote edit; **mutations** require `super_admin` (Closed Beta) |
| `admin-command-center` | Command center; suspend/listings/announcements/flags require `super_admin` |
| `marketplace-verification-admin` | Verification decisions require `super_admin` |
| `floral-library-admin` | `super_admin` or `content_admin` |

Reads (dashboard, lists) remain available to any active platform admin.

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
