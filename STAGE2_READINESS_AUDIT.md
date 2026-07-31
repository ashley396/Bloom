# Florisyn (Bloom / Floravia) — Stage 2 Readiness Audit

**Target:** Production-grade, multi-tenant SaaS supporting **≥ 5,000 independent flower shops**.
**Scope:** Static SPA in `public/`, ~40 Netlify Functions in `netlify/functions/`, Supabase (Postgres + Auth) schema in `supabase/`, plus `local-ai-bridge/`.
**Status:** Audit only. **No code changed, no database changed, nothing deployed.** For founder approval before any remediation.

Legend for each finding:
- **Migration?** = requires a Supabase/Postgres schema change.
- **Deploy?** = requires deploying updated functions/frontend.

---

## 1. Executive summary

The platform is functional but was assembled incrementally across ~22 versions, and its multi-tenant foundations are **not yet Stage-2 safe**. The three structural risks that dominate everything else:

1. **Tenant isolation is enforced only in application code, not the database.** Every function talks to Supabase with the **service-role key**, which **bypasses Row Level Security**. RLS policies exist on most tables but are effectively dead code for the live data path. Isolation therefore depends on every single function remembering to filter by a server-derived `shop_id` — with **zero automated tests** guarding it. One missing `.eq("shop_id", …)` becomes a cross-tenant data breach.
2. **Reads are unbounded and aggregations run in JavaScript.** Core endpoints (`orders`, `finance`, `customer-insights`, `dashboard`, `expenses`, `staff`) load a shop's *entire* history into a serverless function on every call. This will not survive shops that accumulate tens of thousands of rows, let alone 5,000 shops hitting it concurrently.
3. **Hot-path and high-volume queries are under-indexed.** Most damaging: the per-request membership lookup in `_shared/supabase.js currentUser()` filters `shop_members` by `user_id`, but there is **no index on `user_id`** — so authentication does a sequential scan on every API call.

Payments themselves are relatively well designed (idempotent RPC `post_order_payment`, unique constraints, signature-verified webhooks). The gaps there are the **subscription webhook** (no raw-body handling, no event dedup) and **marketplace checkout** (no idempotency key, no recorded ledger).

There is **no rate limiting**, **no structured monitoring**, **no automated tests**, and **no migration framework** (SQL files are applied by hand in a fragile order — see `AGENTS.md`).

**Counts at a glance**
- Functions using service-role for all access: **~40 (100%)**
- Endpoints with pagination/limits: **5** (`payments` 500-cap, `ai-context`, `admin-console`; the rest unbounded)
- Tables with RLS enabled: 24; **tables missing RLS entirely: `staff_time_entries`** (payroll data)
- Rate-limited endpoints: **0**
- Automated tests: **0** (only `scripts/check.mjs` syntax check)

---

## 2. Architecture context (why the categories below matter)

`_shared/supabase.js`:
```
export function admin(){return createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),…)}
export async function currentUser(event){
  const client=admin();                       // service role → RLS bypassed
  const {data}=await client.auth.getUser(token);
  // profiles.default_shop_id, then shop_members by user_id + status='active'
}
```
`_shared/saas.js` mirrors this with `authenticatedUser()` (also service role) and a *second*, divergent tenancy helper set (`user_has_shop_access` vs `is_shop_member`; `owner_user_id` vs `owner_id`). Because the service role bypasses RLS, **the database is not a second line of defense** — the application is the only line of defense. Good news: the browser never sees the service-role key (verified: no `service_role`/`createClient` in `public/`), and `shopId` is server-derived, not trusted from the client (except `tenant-config.js`, which validates membership). Bad news: there is nothing to catch a regression.

---

## 3. Findings

### 3.1 Critical

---

**C1 — Tenant isolation relies solely on service-role application code; RLS is bypassed**
- **File/function:** `netlify/functions/_shared/supabase.js` (`admin`, `currentUser`), `_shared/saas.js` (`admin`, `authenticatedUser`); consumed by all ~40 functions.
- **Why it matters:** RLS on `orders`, `customers`, `payments`, etc. never executes because every query runs as `service_role`. Isolation is a hand-maintained invariant (`.eq("shop_id", shopId)`) with no test coverage. A single omission or a `body.id`-only update leaks or mutates another shop's data.
- **Expected failure at scale:** At 5,000 shops the blast radius of any isolation bug is the entire customer base (PII, orders, payment history). This is the #1 breach vector.
- **Recommended fix:** (a) Add an authorization/tenant-isolation **integration test suite** that asserts every resource endpoint rejects cross-shop `id`s and never returns another shop's rows. (b) Move **read paths** to a request-scoped client using the caller's JWT so RLS is actually enforced (defense-in-depth), reserving service-role for privileged writes/RPC. (c) Add a shared `assertShopScoped()` helper used by every query builder.
- **Migration?** No (tests); Yes if you also harden/normalize RLS policies (recommended). **Deploy?** Yes.

---

**C2 — `shop_members` has no index on `user_id`; every request sequential-scans it**
- **File/function:** `_shared/supabase.js currentUser()` → `.from("shop_members").select(...).eq("user_id", …).eq("status","active")`. Schema: `supabase/schema.sql` defines `shop_members` PK `(id)` + `unique(shop_id,user_id)`. No `user_id`-leading index exists (`grep` of all `supabase/*.sql`).
- **Why it matters:** This lookup runs on **every authenticated API call**. The only usable index is `(shop_id,user_id)` whose leading column is `shop_id`, so a `user_id`-only filter cannot use it.
- **Expected failure at scale:** Sequential scan of a growing `shop_members` table on every request → rising latency, DB CPU saturation, and cascading timeouts across all endpoints as membership rows approach 5,000+ shops × N staff.
- **Recommended fix:** `create index concurrently on public.shop_members (user_id, status);`
- **Migration?** Yes. **Deploy?** No (index only).

---

**C3 — `staff_time_entries` has no RLS and no `shop_id` index (payroll data)**
- **File/function:** `supabase/migration_v13.6_staff_timeclock_payroll.sql` (table created, RLS never enabled; only `(staff_id, clock_in)` index). Consumed by `netlify/functions/staff.js`.
- **Why it matters:** Contains hours worked / payroll basis. It is the one exposed business table with **RLS disabled**, so it has no database-level protection at all; and `staff.js` filters it by `shop_id` with no supporting index.
- **Expected failure at scale:** (Security) any future direct/user-scoped access path exposes all shops' payroll; (Performance) `staff` GET loads *all* time entries for a shop with a seq scan and no pagination.
- **Recommended fix:** `alter table public.staff_time_entries enable row level security;` + `create policy … using (public.user_has_shop_access(shop_id));` + `create index on public.staff_time_entries (shop_id, staff_id, clock_in desc);` and paginate the read.
- **Migration?** Yes. **Deploy?** Yes (for pagination).

---

**C4 — Unbounded reads on core tables (no pagination, full-history fetches)**
- **File/function:** `orders.js` (GET `select("*")` all orders), `finance.js` (all orders + all expenses), `customer-insights.js` (all orders, filtered in JS), `dashboard.js` (all orders/inventory/customers/expenses), `expenses.js`, `customers.js`, `inventory.js`, `deliveries.js`, `products.js`, `marketplace.js`, `suppliers.js`, `staff.js` (all time entries).
- **Why it matters:** Each request pulls an entire per-shop table into a Lambda and serializes it as JSON. No `.range()`/`.limit()`.
- **Expected failure at scale:** Memory blowups and multi-second/timeout responses for established shops (10k–100k orders), amplified under concurrency. The dashboard/finance/insights endpoints become the platform's slowest and most expensive calls.
- **Recommended fix:** Add cursor/offset pagination (`.range()`) and hard caps to all list endpoints; push analytics (`dashboard`, `finance`, `customer-insights`) into **SQL aggregates / rollup RPCs** instead of fetching rows and reducing in JS. Add `?limit/?cursor` params to the SPA calls.
- **Migration?** Yes (aggregate RPCs + supporting indexes). **Deploy?** Yes.

---

**C5 — Order creation is not idempotent and inventory decrement is a non-atomic read-modify-write**
- **File/function:** `orders.js` POST (order insert + deliveries insert + per-recipe loop reading `inventory`, then `update({quantity: after})`).
- **Why it matters:** (1) No idempotency key → a retried/double-submitted POST creates **duplicate orders** (and would double-decrement inventory). (2) The recipe loop reads stock then writes `before - used` — a classic **lost-update race**; two concurrent orders for the same stem oversell it. (3) It is also an **N+1** (one UPDATE per recipe ingredient).
- **Expected failure at scale:** Duplicate orders on flaky mobile networks; oversold inventory during busy periods (Valentine's/Mother's Day) when concurrency is highest. Deliveries are partly protected by `unique(order_id)` (v9.1), orders are not.
- **Recommended fix:** Accept a client `idempotency_key` and enforce `unique(shop_id, idempotency_key)` on `orders`; move order+delivery+inventory decrement into a **single transactional RPC** using `SELECT … FOR UPDATE` / atomic `quantity = quantity - used` with a guard.
- **Migration?** Yes (idempotency column/constraint + RPC). **Deploy?** Yes.

---

### 3.2 High

---

**H1 — Subscription webhook: no raw-body handling and no event-dedup record**
- **File/function:** `stripe-subscription-webhook.js`.
- **Why it matters:** It calls `stripe.webhooks.constructEvent(event.body, …)` using `event.body` directly — unlike `stripe-order-webhook.js`, which correctly handles `event.isBase64Encoded` raw bytes. On Netlify the body can be base64-encoded, breaking signature verification. There is also **no processed-events table**; Stripe does not guarantee ordering or single delivery, so a replayed or out-of-order `customer.subscription.*` event can regress subscription status.
- **Expected failure at scale:** Silent subscription desync (paid shops flipped to trial/canceled or vice versa); intermittent 400s from signature failures. Requirement #11 (preserve an event-processing record) is unmet.
- **Recommended fix:** Reconstruct the raw body via `isBase64Encoded` (mirror the order webhook); add a `stripe_events(event_id primary key, type, processed_at)` table and skip already-processed `event.id`; guard state transitions.
- **Migration?** Yes (events table). **Deploy?** Yes.

---

**H2 — Marketplace checkout: no idempotency key, no recorded ledger, no role check**
- **File/function:** `marketplace-checkout.js`.
- **Why it matters:** `stripe.checkout.sessions.create(...)` is called **without** an `idempotencyKey` (contrast `create-checkout.js`, which passes one), so a double-click creates duplicate Connect charges. No order/purchase row is written and there is **no marketplace webhook**, so there is no idempotent record of wholesale purchases. Any active member (even a driver) can initiate a checkout (no `requireRoles`).
- **Expected failure at scale:** Duplicate supplier charges and disputes; no reconciled record of marketplace transactions.
- **Recommended fix:** Pass a client idempotency key to Stripe; create a `marketplace_orders` row; add a marketplace webhook that records fulfillment via an idempotent RPC; add `requireRoles(['owner','manager'])`.
- **Migration?** Yes (`marketplace_orders`). **Deploy?** Yes.

---

**H3 — No rate limiting or abuse protection on any endpoint**
- **File/function:** all functions; most acute on `auth-login.js`, `auth-signup.js`, `auth-refresh.js`, `admin-bootstrap.js` (public), and cost-bearing `ai-assistant.js`/`content-helper.js` and `route-distance.js`.
- **Why it matters:** No per-IP / per-user / per-shop throttling anywhere (`grep` finds no rate-limit/429 logic). Credential stuffing, signup spam, and AI/Maps cost-amplification are unmitigated.
- **Expected failure at scale:** Auth brute-force, runaway Cloudflare AI / Google Maps bills, and a single abusive tenant degrading the shared function pool for all 5,000 shops.
- **Recommended fix:** Add rate limiting (Netlify edge middleware or a shared store such as Upstash/`rate_limits` table) keyed by IP + user + shop; strict limits on auth, AI, and Maps; return `429` with `Retry-After`. Add per-shop AI quotas.
- **Migration?** Optional (if using a DB-backed limiter). **Deploy?** Yes.

---

**H4 — Slow third-party work runs synchronously in the request path**
- **File/function:** `ai-assistant.js` / `content-helper.js` (Cloudflare AI), `route-distance.js` (Google Maps), `expenses.js` GET (one `createSignedUrl` per row — N+1 external calls), Stripe calls in `create-checkout`/`stripe-connect`.
- **Why it matters:** These block the function until the third party responds, with no backoff/circuit-breaker; `expenses` GET multiplies external calls by the number of receipts.
- **Expected failure at scale:** Function timeouts and cost spikes when providers slow down; the expenses page degrades linearly with receipt count. Requirement #9 (async for slow work) unmet.
- **Recommended fix:** Move AI, report generation, email/SMS, image processing, and bulk import to **async jobs/queue**; cache route lookups by address hash; batch or pre-issue signed URLs (or store durable public paths). Add timeouts + retries + fallback messaging (#16).
- **Migration?** Maybe (jobs table). **Deploy?** Yes.

---

**H5 — `currentUser()` does 3 sequential round-trips and calls GoTrue on every request**
- **File/function:** `_shared/supabase.js currentUser()` (`auth.getUser` → `profiles` → `shop_members`).
- **Why it matters:** Every authenticated call makes a network `getUser` to the Auth server plus two DB round-trips, serialized. This multiplies latency and puts constant load on GoTrue.
- **Expected failure at scale:** Auth server becomes a bottleneck; p95 latency dominated by fixed per-request overhead across all endpoints.
- **Recommended fix:** Verify the JWT **locally** (e.g., `jose` with the project JWT secret) instead of a network `getUser`; fetch profile + membership in a single query/RPC. Note connection-pooling guidance (#8): current PostgREST/HTTP access is pooler-safe; if any *direct* Postgres connection is later added, use the **transaction pooler (port 6543)**, never a per-invocation direct connection.
- **Migration?** Maybe (combined RPC). **Deploy?** Yes.

---

**H6 — PostgREST filter injection via admin search**
- **File/function:** `admin-console.js`, action `shops`: `query.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%`)` from raw user input.
- **Why it matters:** Unescaped user input interpolated into a PostgREST `.or()` filter allows altering the filter (comma/paren injection). Admin-only today, but still a service-role-powered surface.
- **Expected failure at scale:** Crafted search strings return unintended columns/rows or error; privilege-escalation risk on the highest-privilege endpoint.
- **Recommended fix:** Sanitize/escape the search term (strip `,`/`()`/`%` or use `.ilike` with parameterized values / an RPC).
- **Migration?** No. **Deploy?** Yes.

---

**H7 — Raw internal/DB error messages returned to clients**
- **File/function:** `_shared/supabase.js fail()` and `_shared/saas.js fail()` return `error.message` in the response body; thrown Supabase errors carry SQL/constraint text.
- **Why it matters:** Leaks schema/constraint names and internal detail to the browser (requirement #13). Also no request correlation for debugging.
- **Expected failure at scale:** Information disclosure that aids attackers; hard-to-triage incidents without structured logs.
- **Recommended fix:** Log the full error server-side with a request ID; return a generic user-safe message + code. Keep validation messages explicit, DB errors opaque.
- **Migration?** No. **Deploy?** Yes.

---

### 3.3 Medium

---

**M1 — Missing composite indexes for common list/sort/filter paths**
- **File/function:** `orders.js`/`dashboard.js` sort by `created_at` but no `orders(shop_id, created_at)` index (existing order indexes are `(shop_id,delivery_date)`, `(shop_id,priority)`, `(shop_id,payment_status,paid_at)`); `expenses.js` sorts by `expense_date` (no `expenses(shop_id, expense_date)`); `deliveries.js` sorts by `created_at`; `customer-insights` matches on phone (no phone index); `audit_events`/`integration_events` have `shop_id` but no time index.
- **Why it matters / failure at scale:** Sorts and filters fall back to scans + in-memory sort as histories grow → slow list/dashboard endpoints.
- **Recommended fix:** Add `(shop_id, created_at desc)` on `orders`, `deliveries`; `(shop_id, expense_date desc)` on `expenses`; a `customers` phone index; time indexes on audit/event tables.
- **Migration?** Yes. **Deploy?** No.

---

**M2 — Analytics computed by loading full tables into JS**
- **File/function:** `dashboard.js`, `finance.js`, `customer-insights.js`.
- **Why it matters / failure at scale:** Same root cause as C4; even with pagination, monthly revenue/expense rollups and lifetime-value should be SQL aggregates, not client-side reductions over full history.
- **Recommended fix:** Implement SQL aggregate RPCs or scheduled materialized rollups (e.g., `shop_daily_stats`); have endpoints read the rollups.
- **Migration?** Yes. **Deploy?** Yes.

---

**M3 — `customer-insights` matches orders by name/phone string, not `customer_id`**
- **File/function:** `customer-insights.js` (fetches all orders, filters by normalized name/phone in JS).
- **Why it matters / failure at scale:** O(all orders) per view, fragile matching, and no FK integrity between `orders` and `customers`.
- **Recommended fix:** Persist `orders.customer_id` on create and query `where customer_id = …` with an index; backfill historically.
- **Migration?** Yes (index + backfill). **Deploy?** Yes.

---

**M4 — Non-atomic onboarding (partial-tenant risk)**
- **File/function:** `complete-onboarding.js` (six `Promise.all` inserts: shop, member, subscription, ai profile, profile, hours, audit).
- **Why it matters / failure at scale:** A mid-way failure leaves an orphaned shop / inconsistent tenant; not transactional.
- **Recommended fix:** Wrap provisioning in a single `security definer` RPC/transaction so it is all-or-nothing.
- **Migration?** Yes (RPC). **Deploy?** Yes.

---

**M5 — Two divergent tenancy models coexist**
- **File/function:** `_shared/supabase.js` (`is_shop_member`, `owner_id`, `handle_new_user` trigger) vs `_shared/saas.js` (`user_has_shop_access`, `owner_user_id`); `supabase/schema.sql` vs `migration_floravia_saas_foundation_v1.sql`; onboarding via trigger vs `complete-onboarding` vs the **undefined** `complete_florist_onboarding` RPC referenced by `complete-florist-onboarding.js`.
- **Why it matters / failure at scale:** Divergent RLS policies and membership semantics make it easy to secure one path and miss another; the undefined RPC path is dead/broken.
- **Recommended fix:** Consolidate on one membership helper, one shop-ownership column, one RLS policy set, and one onboarding path; delete the dead RPC path.
- **Migration?** Yes. **Deploy?** Yes.

---

**M6 — Code references non-existent tables/columns (silent failures)**
- **File/function:** `ai-context.js` and `orders.js` reference table `inventory_items` (actual table is `inventory`); `ai-context.js` selects `deliveries.scheduled_date` (column is `delivery_date`).
- **Why it matters / failure at scale:** Queries error and are swallowed by `try/catch`, so AI context is silently empty — masked today by the absence of monitoring. Indicates missing tests and drift.
- **Recommended fix:** Correct the identifiers; add a schema-contract/integration test; surface such errors via monitoring.
- **Migration?** No. **Deploy?** Yes.

---

**M7 — Missing owner/role checks on privileged Stripe endpoints**
- **File/function:** `stripe-connect.js` (creates/links a Connect account for the shop) and `create-subscription-checkout.js` — neither calls `requireRoles`, so any active member can act.
- **Why it matters / failure at scale:** A non-owner could initiate payout onboarding or billing changes.
- **Recommended fix:** `requireRoles(['owner'])` (or `owner`/`manager`) on both.
- **Migration?** No. **Deploy?** Yes.

---

**M8 — Public owner-bootstrap has a race / re-seizure risk**
- **File/function:** `admin-bootstrap.js` (unauthenticated; creates first `platform_admins` row if none exists).
- **Why it matters / failure at scale:** Two concurrent POSTs can both pass the count check; if `platform_admins` is ever emptied, anyone can claim platform ownership. Also unauthenticated + unthrottled.
- **Recommended fix:** Guard with a unique/advisory-lock or one-time bootstrap token; rate-limit; disable after first use via config.
- **Migration?** Maybe. **Deploy?** Yes.

---

### 3.4 Later (Stage-2 hardening, lower immediate risk)

- **L1 — No environment separation / migration framework.** SQL files are hand-applied in a fragile, inconsistent order (documented in `AGENTS.md`; three divergent lineages). Adopt timestamped Supabase migrations, separate local/staging/prod projects, and CI-gated migrations (requirement #14). *Migration/process. Deploy: process.*
- **L2 — No structured logging/monitoring.** Only `console.error`. Add request IDs, error tracking (Sentry/Logflare), metrics, and alerting (requirement #13). *Deploy: yes.*
- **L3 — No automated tests.** Only `scripts/check.mjs` (syntax). Add auth, authorization, tenant-isolation, order/payment workflow, and shop-switching tests (requirement #15). *Deploy: CI.*
- **L4 — Graceful degradation is partial.** AI falls back cloud→local, but Stripe/Maps/email have no queueing or user-facing degradation (requirement #16). *Deploy: yes.*
- **L5 — Unbounded audit/event growth.** `audit_events`, `platform_admin_audit`, `integration_events`, `platform_admin_notifications` grow forever with no retention/partitioning. Add retention + time indexes. *Migration: yes.*
- **L6 — `payments` GET capped at 500 but not paginated;** move to cursor pagination. *Deploy: yes.*
- **L7 — No caching for AI/route lookups;** identical requests re-bill providers. *Deploy: yes.*

---

## 4. Requirement-by-requirement scorecard (1–18)

| # | Requirement | Status | Key finding(s) |
|---|---|---|---|
| 1 | Strict tenant isolation via `shop_id` | ⚠️ Partial | Enforced in code only; no tests — C1 |
| 2 | RLS enabled/verified on every exposed table | ❌ Gap | `staff_time_entries` no RLS (C3); RLS bypassed by service role (C1) |
| 3 | Users access only shops with active membership | ✅ Mostly | `currentUser`/`stores`/`tenant-config` validate membership |
| 4 | Never trust browser `shop_id` | ✅ Mostly | `shopId` server-derived; `tenant-config` validates the one query param |
| 5 | Indexes for shop-scoped/date/status/etc. | ❌ Gap | `shop_members(user_id)` missing (C2); composite gaps (M1) |
| 6 | No unbounded queries; pagination | ❌ Gap | C4, M2 |
| 7 | Avoid N+1 / repeated calls | ⚠️ Partial | `orders` recipe loop, `expenses` signed URLs (H4, C5) |
| 8 | Correct connection pooling for serverless | ✅ OK (HTTP) | PostgREST HTTP path is pooler-safe; guidance in H5 for future direct connections |
| 9 | Async for slow work (AI/email/SMS/reports/imports) | ❌ Gap | All synchronous — H4 |
| 10 | Idempotent payments/webhooks | ⚠️ Partial | Order payments idempotent; **order create** (C5), **marketplace** (H2), **subscription webhook** (H1) not |
| 11 | Verify webhook signatures + dedup record | ⚠️ Partial | Signatures verified; **no dedup table** for subscription events — H1 |
| 12 | Rate limiting / abuse protection | ❌ Gap | None — H3 |
| 13 | Structured error logging; no secret/stack leak | ❌ Gap | Raw DB messages returned; console-only logs — H7, L2 |
| 14 | Separate local/staging/prod + controlled migrations | ❌ Gap | Hand-applied SQL — L1 |
| 15 | Automated tests (authn/authz/isolation/orders/payments/switching) | ❌ Gap | None — L3 |
| 16 | Degrade safely on third-party outage | ⚠️ Partial | AI fallback only — L4 |
| 17 | No service-role/secret keys in browser | ✅ OK | Verified none in `public/` |
| 18 | Document features that can't meet Stage 2 before building | ⚠️ Process | This audit begins that practice |

---

## 5. Likely first bottlenecks at 5,000 shops (ranked)

1. **Auth/membership hot path** — `shop_members(user_id)` seq scan + `getUser` on every call (C2, H5).
2. **Dashboard / finance / customer-insights** — full-history fetch + JS aggregation (C4, M2, M3).
3. **Orders list & creation** — unbounded GET (C4) and non-atomic create + oversell under peak concurrency (C5).
4. **AI and Maps endpoints** — synchronous, uncached, unthrottled cost/latency amplification (H3, H4).
5. **Auth endpoints** — unthrottled brute-force/signup spam (H3).

---

## 6. Recommended remediation order (no changes made yet)

1. **Critical, DB-only first (low risk, high payoff):** C2 and C3 indexes/RLS (`create index concurrently`, enable RLS on `staff_time_entries`). *Migration only, no deploy.*
2. **Critical, code+DB:** C4 pagination + C5 transactional idempotent order RPC; C1 tenant-isolation test suite (add before further feature work).
3. **High:** H1 (subscription webhook raw body + dedup), H2 (marketplace idempotency + ledger), H3 (rate limiting), H4 (async jobs), H5 (local JWT verify), H6/H7 (injection + error hygiene).
4. **Medium:** M1–M8.
5. **Later:** L1–L7 (migrations framework, monitoring, tests, degradation, retention).

Nothing above has been implemented. Awaiting founder approval to proceed, and to confirm priority/sequencing and any scope constraints (e.g., which async-job/rate-limit infrastructure to standardize on).
