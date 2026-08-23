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
(P0-02 R1 / P0-02 R2 / P0-02 R3 / P0-02 R4): public responses come only from the Florisyn-owned
error catalog, and only for errors created by `platformAdminError()` (module-owned brand via
private `WeakSet` — forged `florisynCode` values become generic 500). Catalog code lookup uses
`Object.hasOwn` only (prototype keys like `toString` / `constructor` / `__proto__` resolve to
`unexpected` 500). Nested catalog entries are deeply frozen. Unknown / provider errors become
generic 500. Request bodies are parsed by shared `parsePlatformAdminJsonBody()` (empty → `{}`;
valid object → object; malformed/non-object → branded `invalid_request` 400). The marketplace
verification admin missing-table path maps to `verification_schema_unavailable` and **returns**
the 503 response (handler promise resolves; never rethrows from the final catch). Production
Netlify handlers are factory-bound with real dependencies; the Netlify `context` argument cannot
override `authenticate`, `createServerClient`, authorization, or service-role behavior (P0-02 R4).
Logs use a server-generated `requestId` (`crypto.randomUUID()` per request via WeakMap); browser
`x-request-id` / `x-correlation-id` headers are never trusted. Logs enforce allowlisted event
names, categories, and HTTP statuses only.

| Function | Access (Founding Beta) | Mutations | Notes |
|----------|------------------------|-----------|-------|
| `admin-console` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | All POST actions → `requireSuperAdmin(admin)` immediately before write | |
| `admin-command-center` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | All POST actions → `requireSuperAdmin(admin)` immediately before write | |
| `marketplace-verification-admin` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | Verification review (POST) → `requireSuperAdmin(admin)` | |
| `floral-library-admin` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | Import/approve/duplicate-review → `requireSuperAdmin(admin)` before each write | |
| `admin-photo-manager` | `super_admin` only — `platformAdmin(event, ["super_admin"])` | Upload/update/delete → `requireSuperAdmin(admin)` before each write | `public_list` action is intentionally unauthenticated (read-only, mirrors the Floral Library/Website Studio content it serves) |
| `marketing-studio` | `super_admin` only — `platformAdmin(event, ["super_admin"])`, additionally gated behind the `MARKETING_STUDIO` feature flag (default off) | Brand Brain update/forget/reset, `plan_month`, `approve_content`, `generate_content`, `request_clone_enrollment`, `revoke_clone_consent`, `enqueue_publish`, `run_publishing_queue`, `connect_platform`, `disconnect_platform`, `create_ab_experiment`, `evaluate_ab_experiment` → `requireSuperAdmin(admin)` before each write | Founding Beta / Stage B-F — real image+copy generation via existing Cloudflare/Lily engines; video content only ever gets a real script/storyboard (`renderingAvailable:false`), never a rendered file; AI Clone enrollment always returns not-live (no provider connected) but consent is captured and revocable for real; the publishing queue (retry/backoff/dead-letter) is real, but every publish attempt fails honestly (`social_provider_not_live`) since none of the 7 platforms has a live, approved adapter — `connect_platform` reports whether OAuth env credentials are configured (all false today) but never fabricates an authorize redirect; `analytics_summary`/`list_insights` are real machinery over honestly-empty data until Stage E actually publishes; `evaluate_ab_experiment` never declares a winner below a real minimum sample size per variant; `plan_month`/`enqueue_publish` are idempotent |

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

## Pull-request verification (P0-03 / P0-03 R1)

Automated pull-request checks on PRs to `main` via `.github/workflows/p0-required-checks.yml`
(digest-pinned PostgreSQL 16 service). Those suites exercise database grants/policies in an
isolated CI database — they do not deploy, do not apply hosted migrations, and do not use
production service-role credentials. Platform-admin Tier 2 handlers remain verified by the
non-Postgres unit suite (`tests/platform-admin-authorization-boundary.test.js`) in the core job.

Frontend dependency auditing uses `scripts/audit-frontend-security.mjs`: root audit stays at
zero high/critical findings; frontend temporarily allows only `GHSA-qwww-vcr4-c8h2` for
`react-router` / `react-router-dom@7.18.2` under non-RSC / `publish=public` conditions until
**2026-08-15** (UTC) or React production migration, whichever is first. Exception lifecycle
(P0-03 R2): those gates run only when the approved advisory is present; clean audits pass
without them. Review owner: Technical Director. These are automated checks — not confirmed
here as branch-protection required status checks.
