# Stage 2A — Implementation Plan (DB hardening + tenancy reconciliation analysis)

**Status:** Plan only. **No migration executed, no database modified, nothing deployed.** Awaiting per-migration founder approval (standard #10).

**Scope of Stage 2A**
1. `M-2A-01` — `shop_members(user_id)` index (audit **C2**).
2. `M-2A-02` — `staff_time_entries` RLS + indexes (audit **C3**).
3. `M-2A-03` — essential composite indexes (audit **M1**).
4. Tenancy-model reconciliation **analysis + roadmap** (audit **M5**) — analysis only, no schema change in 2A.

**How this plan complies with the approved standards**
- Each DB change is a **versioned SQL migration** (#8), delivered as its own small, reversible unit with rollback SQL (#9).
- All three migrations are **DB-only** (no function/frontend change) → they do not by themselves move any endpoint to user-JWT/RLS; that is Stage 2B and depends on the tenancy reconciliation below (#1, #2).
- Async processing (#4/#5) and rate limiting (#6/#7) are **out of scope for 2A** and are not touched here.
- No final rate-limit numbers are proposed (#7). No new product features (per instruction).
- **Nothing is executed** — SQL is provided for review; execution happens only after approval, per phase (#10).

**Migration mechanics assumed for all index changes**
All index creation uses `CREATE INDEX CONCURRENTLY`, which **cannot run inside a transaction block**. When these are committed as migration files, each `CONCURRENTLY` statement must be in its **own migration file with transaction wrapping disabled** (e.g., Supabase CLI `-- supabase: no-transaction`, or applied via a runner that does not wrap in `BEGIN`). This is called out per migration.

---

## 0. Current-state evidence (read-only introspection of the schema)

Captured via read-only `psql` introspection (no data or DDL changed):

| Fact | Observed | Source |
|---|---|---|
| `service_role` bypasses RLS | `rolbypassrls = t` | `pg_roles` |
| `authenticated` / `anon` bypass RLS | `f` (RLS **will** apply once used) | `pg_roles` |
| `staff_time_entries` RLS | **disabled** (`relrowsecurity = f`) | `pg_class` |
| All other business tables RLS | enabled | `pg_class` |
| `shop_members` indexes | PK`(id)`, unique`(shop_id,user_id)` — **no `user_id`-leading index** | `pg_indexes` |
| `orders` indexes | `(shop_id)`, `(shop_id,delivery_date)`, `(shop_id,payment_status,paid_at)`, `(shop_id,priority)` — **no `(shop_id,created_at)`** | `pg_indexes` |
| `expenses` indexes | `(shop_id)` only — **no `(shop_id,expense_date)`** | `pg_indexes` |
| `deliveries` indexes | **two duplicate** `(shop_id)` indexes (`deliveries_shop_idx`, `deliveries_shop_id_idx`); no `(shop_id,created_at)` | `pg_indexes` |
| `staff_time_entries` indexes | PK`(id)`, `(staff_id,clock_in desc)` — **no `shop_id` index** | `pg_indexes` |
| Tenancy helpers present | `is_shop_member(uuid)` (status-agnostic), `user_has_shop_access(uuid)` (**requires `status='active'`**), `user_is_shop_owner(uuid)` | `pg_proc` |
| `shops` ownership column | **`owner_id` only** (no `owner_user_id`), though `complete-onboarding.js` writes `owner_user_id` | `information_schema.columns` |
| `shop_members.status` values | `active` only (local); no nulls | `shop_members` |

> The local schema was built from the repo SQL in the order documented in `AGENTS.md`. **Production may differ** (three divergent SQL lineages exist). Every migration below therefore includes a **read-only pre-check** to run against production first (§5).

---

## 1. `M-2A-01` — Index `shop_members(user_id, status)` (C2)

**Problem.** `_shared/supabase.js currentUser()` runs on every authenticated request and filters `shop_members` by `user_id` (+ `status='active'`). The only indexes are PK`(id)` and unique`(shop_id,user_id)` (leading column `shop_id`), so a `user_id`-only lookup cannot use an index → sequential scan on every API call.

### Exact SQL (forward)
```sql
-- Migration: 2A-01  shop_members user_id hot-path index
-- Run OUTSIDE a transaction (CONCURRENTLY).
CREATE INDEX CONCURRENTLY IF NOT EXISTS shop_members_user_id_status_idx
  ON public.shop_members (user_id, status);
```

### Rollback SQL
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.shop_members_user_id_status_idx;
```

### Locking / downtime risk
- `CREATE INDEX CONCURRENTLY` takes only a `SHARE UPDATE EXCLUSIVE` lock: **reads and writes to `shop_members` continue**. No downtime.
- It does two table scans and waits for in-flight transactions; on a small table like `shop_members` this is milliseconds–seconds.
- If it fails midway it can leave an `INVALID` index; rollback (`DROP INDEX CONCURRENTLY IF EXISTS`) cleans it up, then re-run.

### Testing
- **Local/staging:** `EXPLAIN (ANALYZE, BUFFERS) SELECT shop_id,role,status FROM shop_members WHERE user_id = '<uuid>' AND status='active';` — expect `Index Scan using shop_members_user_id_status_idx` after, `Seq Scan` before. (On tiny tables the planner prefers seq scan regardless; validate on a **seeded, production-sized** staging table, e.g. ≥100k rows.)
- Confirm `SELECT indisvalid FROM pg_index WHERE indexrelid='public.shop_members_user_id_status_idx'::regclass;` → `t`.
- Run the app end-to-end (login + any authenticated call) to confirm no behavior change.

### Could existing production rows violate this?
**No.** Non-unique index; it cannot conflict with or reject any row. Zero data-integrity risk.

---

## 2. `M-2A-02` — `staff_time_entries` RLS + indexes (C3)

**Problem.** `staff_time_entries` (payroll hours) has **RLS disabled** and **no `shop_id` index**. It is the only exposed business table with no database-level tenant protection, and `staff.js` filters it by `shop_id` unindexed.

### Exact SQL (forward)
Split into two files because the index uses `CONCURRENTLY` (no transaction) while the RLS statements should be transactional.

**2A-02a (transactional): enable RLS + read policy**
```sql
BEGIN;
-- Pre-condition: user_has_shop_access(uuid) must exist (Floravia foundation). Verified in prod pre-check §5.
ALTER TABLE public.staff_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read staff time entries" ON public.staff_time_entries;
CREATE POLICY "members read staff time entries"
  ON public.staff_time_entries
  FOR SELECT
  USING (public.user_has_shop_access(shop_id));
COMMIT;
```
*Write policies are intentionally deferred to Stage 2B (when `staff.js` moves to user-JWT). Until then, writes continue via the service role, which bypasses RLS — matching the existing `payments` table precedent (RLS on, SELECT policy only).*

**2A-02b (no transaction): supporting index**
```sql
-- Run OUTSIDE a transaction (CONCURRENTLY).
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_time_entries_shop_staff_idx
  ON public.staff_time_entries (shop_id, staff_id, clock_in DESC);
```

### Rollback SQL
```sql
-- 2A-02b
DROP INDEX CONCURRENTLY IF EXISTS public.staff_time_entries_shop_staff_idx;
-- 2A-02a
BEGIN;
DROP POLICY IF EXISTS "members read staff time entries" ON public.staff_time_entries;
ALTER TABLE public.staff_time_entries DISABLE ROW LEVEL SECURITY;
COMMIT;
```
> Rollback of 2A-02a restores the **current (insecure) state**; acceptable as an emergency reversal only.

### Locking / downtime risk
- `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` take a brief `ACCESS EXCLUSIVE` lock (catalog change) — milliseconds; they block concurrent access to this one table only for that instant. Effectively no downtime.
- The index uses `CONCURRENTLY` (no blocking) as in §1.
- **Behavioral risk:** After enabling RLS, any access path that is *not* service-role and *not* covered by a policy loses access. In 2A, `staff.js` still uses the service role (bypass), so **no functional change**. The only effect is closing direct anon/authenticated reads — the intended fix.

### Testing
- **Service-role unaffected:** with the service-role key, `SELECT` still returns rows (bypass). Run `staff.js` GET end-to-end.
- **Policy enforced for authenticated:** simulate a member vs non-member:
  ```sql
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<member-user-uuid>","role":"authenticated"}';
  SELECT count(*) FROM public.staff_time_entries;         -- only that member's shops
  SET LOCAL request.jwt.claims = '{"sub":"<non-member-uuid>","role":"authenticated"}';
  SELECT count(*) FROM public.staff_time_entries;         -- expect 0
  RESET ROLE;
  ```
- Confirm index validity as in §1.

### Could existing production rows violate this?
- RLS `USING` is a **visibility filter**, not a constraint, and no `WITH CHECK` is added → **no existing row is rejected**.
- Rows whose `shop_id` refers to a shop the caller is not an active member of become invisible to that caller — that is the intended security behavior.
- **Pre-checks to run on production (read-only, §5):** (a) `user_has_shop_access(uuid)` exists; (b) no `staff_time_entries.shop_id IS NULL` (would be invisible to everyone — should be zero, column is NOT NULL); (c) `staff_time_entries.shop_id` matches its `staff.shop_id` (data-integrity sanity; mismatches would still be safe but indicate a pre-existing bug).

---

## 3. `M-2A-03` — Essential composite indexes (M1)

**Problem.** The most common list/sort queries lack supporting composite indexes and fall back to scan + in-memory sort as histories grow.

Essential set (chosen strictly from observed query patterns):

| Index | Serves (file/function) | Query shape |
|---|---|---|
| `orders (shop_id, created_at DESC)` | `orders.js` GET, `dashboard.js` | `WHERE shop_id=? ORDER BY created_at DESC` |
| `expenses (shop_id, expense_date DESC)` | `expenses.js` GET, `finance.js` | `WHERE shop_id=? ORDER BY expense_date DESC` |
| `deliveries (shop_id, created_at DESC)` | `deliveries.js` GET | `WHERE shop_id=? ORDER BY created_at DESC` |

### Exact SQL (forward)
```sql
-- Run OUTSIDE a transaction (each CONCURRENTLY).
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_shop_created_idx
  ON public.orders (shop_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS expenses_shop_date_idx
  ON public.expenses (shop_id, expense_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS deliveries_shop_created_idx
  ON public.deliveries (shop_id, created_at DESC);
```

### Rollback SQL
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.orders_shop_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.expenses_shop_date_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.deliveries_shop_created_idx;
```

### Optional cleanup (separate, deferrable PR)
`deliveries` has two identical `(shop_id)` indexes. After `deliveries_shop_created_idx` lands (which also covers `shop_id` prefix lookups), drop the redundant pair to reclaim write overhead:
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.deliveries_shop_idx;     -- keep one only
DROP INDEX CONCURRENTLY IF EXISTS public.deliveries_shop_id_idx;  -- (review which callers/tools reference either)
```
*Deferred: verify no ORM/tooling references before dropping. Not required for 2A.*

### Locking / downtime risk
- All `CONCURRENTLY` (no blocking). `orders` is the largest table, so its build is the longest — still online. Schedule off-peak to minimize the concurrent-build load.

### Testing
- `EXPLAIN (ANALYZE, BUFFERS)` each query on **production-sized staging** and confirm `Index Scan` + no separate `Sort` node.
- Confirm each `indisvalid = t`.
- Compare p95 latency of `orders`/`dashboard`/`expenses`/`finance` endpoints before/after on staging.

### Could existing production rows violate this?
**No** — all non-unique; cannot reject rows.

---

## 4. Tenancy-model reconciliation — analysis & roadmap (M5)

> **Analysis only. No schema or code change proposed for execution in 2A.** This section produces the decisions and the **function access matrix (standard #3)** required before the Stage 2B JWT/RLS refactor.

### 4.1 The two coexisting models (evidence)

| Dimension | Model A — `schema.sql` lineage | Model B — Floravia lineage |
|---|---|---|
| Shop ownership column | `shops.owner_id` | `shops.owner_user_id` |
| Membership helper | `is_shop_member(shop_id)` — **any** membership (ignores `status`) | `user_has_shop_access(shop_id)` — requires `status='active'`; `user_is_shop_owner(shop_id)` |
| App auth helper | `_shared/supabase.js currentUser()` | `_shared/saas.js authenticatedUser()` |
| Provisioning | `handle_new_user` trigger on signup | `complete-onboarding.js` (multi-insert) and the **undefined** `complete_florist_onboarding` RPC referenced by `complete-florist-onboarding.js` |
| RLS policies | business tables use `is_shop_member` (e.g., `orders`, `staff`) | Floravia tables + `payments` use `user_has_shop_access` |

**Concrete conflict:** the live schema has `shops.owner_id` only, but `complete-onboarding.js` inserts `owner_user_id` → that onboarding path cannot succeed against this schema. `shop_members` also carries two overlapping SELECT policies (`is_shop_member` and `user_has_shop_access`), which differ on whether `status='active'` is required.

### 4.2 Recommended target model

Adopt **Model B semantics** as the single source of truth, because it enforces `status='active'` (aligns with approved standards #1 and #3) and supports the richer role set:
- **Authorization helper:** `user_has_shop_access(shop_id)` for tenant access; `user_is_shop_owner(shop_id)` (and a future `user_has_shop_role(shop_id, roles[])`) for privileged actions. **Deprecate `is_shop_member`** (status-agnostic).
- **Ownership column:** standardize on one column. Decision requires the **production schema audit** (§5) to see which column production actually uses; then either (i) migrate data into the chosen column and drop the other, or (ii) add the missing column + backfill. Do **not** guess.
- **Membership status:** canonical states `('invited','active','suspended')`; only `active` grants access.
- **Provisioning:** one transactional `security definer` RPC (folds in M4); delete the dead `complete_florist_onboarding` path.
- **RLS policies:** one consistent policy set per table using `user_has_shop_access` / `user_is_shop_owner`, applied uniformly so that when endpoints switch to user-JWT (2B) the database enforces isolation.

### 4.3 Function access matrix (standard #3 — required before 2B refactor)

Target classification for all endpoints (drives the 2B refactor; **no change made now**). "Current" = today's implementation; "Target" = Stage 2B goal.

| Function | Current auth | **Target class** | Notes / required authorization |
|---|---|---|---|
| `health` | none | **public** | no data access |
| `auth-login` | anon key → GoTrue | **public** | add perimeter rate limit (2C) |
| `auth-signup` | anon key → GoTrue | **public** | rate limit + abuse controls (2C) |
| `auth-refresh` | anon key → GoTrue | **public** | rate limit (2C) |
| `admin-bootstrap` | none (one-time) | **public (guarded)** | one-time owner seed; add lock/token (M8) |
| `stripe-order-webhook` | Stripe signature | **webhook** | keep; already raw-body safe |
| `stripe-subscription-webhook` | Stripe signature | **webhook** | fix raw body + dedup (H1) |
| `dashboard` | service role | **user JWT + RLS** | tenant via RLS; move analytics to RPC (M2) |
| `orders` | service role | **user JWT + RLS** | writes need atomic RPC (C5) |
| `inventory` | service role | **user JWT + RLS** | |
| `customers` | service role | **user JWT + RLS** | |
| `expenses` | service role | **user JWT + RLS** | receipt signed-URLs → async/batch (H4) |
| `deliveries` | service role | **user JWT + RLS** | |
| `products` | service role | **user JWT + RLS** | |
| `recipes` | service role | **user JWT + RLS** | |
| `suppliers` | service role | **user JWT + RLS** | |
| `marketplace` | service role | **user JWT + RLS** | own-shop listings |
| `customer-insights` | service role | **user JWT + RLS** | refactor to `customer_id` (M3) |
| `finance` | service role | **user JWT + RLS** | SQL aggregates (M2) |
| `ai-context` | service role | **user JWT + RLS** | fix `inventory_items`→`inventory` bug (M6) |
| `settings` | service role + `requireRoles` | **user JWT + RLS** | owner/manager via role check/policy |
| `staff` | service role + `requireRoles` | **user JWT + RLS** | owner/manager; `staff_time_entries` policies (2B) |
| `stores` | service role | **user JWT + RLS** | switch validates membership; shop-create bootstraps membership → see privileged note |
| `tenant-config` | service role (validates member) | **user JWT + RLS** | already membership-checked |
| `onboarding-status` | service role | **user JWT + RLS** | |
| `route-distance` | service role | **user JWT + RLS** | + cache + rate limit (H4/H3) |
| `ai-assistant` / `content-helper` | service role | **user JWT + RLS** | + per-shop AI quota + async (H3/H4) |
| `inventory-scan` | none (disabled 409) | **user JWT + RLS** (when re-enabled) | currently returns 409 |
| `payments` (POST) | service role → `post_order_payment` (SECURITY DEFINER, granted service_role only) | **privileged service role** | authorize member+role via JWT, then invoke RPC as service role |
| `create-checkout` | service role + `requireRoles` | **privileged service role** | authorize via JWT; Stripe op elevated |
| `verify-checkout` | service role (validates shop) | **privileged service role** | authorize via JWT; posts payment |
| `create-subscription-checkout` | service role | **privileged service role** | add owner role check (M7) |
| `stripe-connect` | service role | **privileged service role** | add owner role check (M7) |
| `marketplace-checkout` | service role | **privileged service role** | add idempotency + ledger (H2), role check |
| `complete-onboarding` | service role | **privileged service role** | bootstraps a tenant for an authenticated user; make transactional (M4) |
| `complete-florist-onboarding` | service role → **undefined RPC** | **remove** | dead path; delete in reconciliation |
| `admin-console` | `platform_admin` + service role | **privileged service role** | platform-admin authZ; fix `.or()` injection (H6) |
| `platform-settings` | authenticated (service role) | **privileged service role** | restrict to platform admins |
| `admin-bootstrap` (POST) | none | **public (guarded)** | see above |

Pattern for **privileged service role** endpoints (standard #2): authenticate + authorize the caller via their **JWT** (membership/role/platform-admin), *then* perform the elevated action with the service role. Service role is never used as a substitute for authorization.

### 4.4 Reconciliation roadmap (later phases — for approval separately)

1. **2B-0 (read-only):** Production schema audit (§5) → decide ownership column and confirm helper/policy inventory.
2. **2B-1 (migration):** Converge ownership column + membership status; unify RLS policies to `user_has_shop_access`/`user_is_shop_owner`; drop `is_shop_member` usage. Small, reversible, per-table.
3. **2B-2 (migration):** Single transactional onboarding RPC (folds M4); delete dead `complete_florist_onboarding` path.
4. **2B-3 (code):** Introduce a request-scoped **user-JWT client** + shared `authorize()` and flip **read** endpoints (matrix "user JWT + RLS") table-by-table, each behind tests (C1).
5. **2B-4 (code):** Convert **privileged** endpoints to the authorize-then-elevate pattern; keep webhooks/public as classified.

**Risks:** policy drift during transition (mitigate: change one table per PR + isolation tests before/after); ownership-column migration touching a hot table (use additive column + backfill + dual-read, then drop); switching a read path to RLS could over-restrict if a policy is too strict (mitigate: verify with the member/non-member test in §2 on staging first).

---

## 5. Production pre-checks (read-only) to run before executing any 2A migration

These do not modify anything and confirm the migrations are safe against the real schema:
```sql
-- Ownership column actually present in production
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='shops'
   AND column_name IN ('owner_id','owner_user_id');

-- Required policy helper exists (needed by M-2A-02)
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname='user_has_shop_access';

-- Indexes that M-2A-01/03 would add (skip if already present)
SELECT indexname FROM pg_indexes WHERE schemaname='public'
 AND indexname IN ('shop_members_user_id_status_idx','orders_shop_created_idx',
                   'expenses_shop_date_idx','deliveries_shop_created_idx',
                   'staff_time_entries_shop_staff_idx');

-- Data-integrity sanity for M-2A-02 (all should return 0 rows)
SELECT count(*) AS null_shop FROM public.staff_time_entries WHERE shop_id IS NULL;
SELECT count(*) AS mismatched FROM public.staff_time_entries e
  JOIN public.staff s ON s.id = e.staff_id
 WHERE e.shop_id <> s.shop_id;

-- Current RLS state of the target table
SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_time_entries'::regclass;
```

---

## 6. Rollout & approval checklist (per phase)

For each migration (`M-2A-01`, `M-2A-02`, `M-2A-03`), in its own small PR (#9):
1. Run §5 production pre-checks; attach output to the PR.
2. Apply to **local** (bootstrap DB) → run functional + `EXPLAIN`/RLS tests (§ per migration).
3. Apply to **staging** with production-sized seed → measure plans + p95; verify `indisvalid`.
4. Founder approval (#10) → apply to **production** in the documented off-peak window.
5. Keep rollback SQL ready; monitor error rates and query plans post-apply.

**DB-only:** none of the 2A migrations require a function/frontend deploy. The tenancy reconciliation (§4) is analysis; its execution is Stage 2B and will be proposed separately for approval.

---

## 7. Explicitly NOT in Stage 2A
- No endpoint moved to user-JWT/RLS yet (Stage 2B, gated on §4).
- No async/queue work (Stage 2 later; standards #4/#5).
- No rate limiting and **no rate-limit numbers** (standards #6/#7).
- No product features, no payment/webhook logic changes, no deploys.
