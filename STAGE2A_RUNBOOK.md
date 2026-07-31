# Stage 2A — Final Production Runbook & Revised M-2A-02 Authorization Policy

**Status:** For founder approval. **Nothing executed, no database modified, no deployment.** Supersedes the migration details in `STAGE2A_IMPLEMENTATION_PLAN.md` where they differ (revised M-2A-02 access model; execution order; deferred index-drop).

## Founder conditions incorporated
- Approved: **M-2A-01**, **M-2A-03**, and **M-2A-02 (conditionally)**.
- **Required execution order: 1) M-2A-01 → 2) M-2A-03 → 3) M-2A-02.**
- **Do NOT drop the existing `deliveries(shop_id)` index during Stage 2A.** Removal deferred until query-plan evidence proves redundancy.
- M-2A-02 read-access model **revised** below to meet Florisyn privacy requirements (no broad "all active members" policy).
- Tenancy direction approved: standardize on `user_has_shop_access` / `user_is_shop_owner`; **`is_shop_member` is NOT deleted in Stage 2A**.
- All three are **database-only**; **no Netlify/frontend/function deployment** in Stage 2A.

## Global mechanics
- Every `CREATE/DROP INDEX` uses `CONCURRENTLY` and must run **outside a transaction** (own migration file, transaction wrapping disabled).
- RLS/policy/function changes are transactional.
- Because `service_role` has `rolbypassrls` and every function currently uses it, **these migrations cause no functional change to the running app**; they are correctness/perf and defense-in-depth for Stage 2B (when endpoints move to user-JWT + RLS).

---

# STEP 1 — M-2A-01: `shop_members(user_id, status)` index

**Forward (outside transaction):**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS shop_members_user_id_status_idx
  ON public.shop_members (user_id, status);
```
**Rollback:**
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.shop_members_user_id_status_idx;
```
**Locking/downtime:** `SHARE UPDATE EXCLUSIVE` only; reads/writes continue; no downtime.
**Verify:** `SELECT indisvalid FROM pg_index WHERE indexrelid='public.shop_members_user_id_status_idx'::regclass;` → `t`; `EXPLAIN` the `currentUser()` lookup on production-sized staging shows `Index Scan`.
**Row-violation risk:** none (non-unique index).

---

# STEP 2 — M-2A-03: composite indexes for `orders`, `expenses`, `deliveries`

**Forward (outside transaction):**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_shop_created_idx
  ON public.orders (shop_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS expenses_shop_date_idx
  ON public.expenses (shop_id, expense_date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS deliveries_shop_created_idx
  ON public.deliveries (shop_id, created_at DESC);
```
**Rollback:**
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.orders_shop_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.expenses_shop_date_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.deliveries_shop_created_idx;
```
**Deferred per founder:** the redundant `deliveries(shop_id)` indexes (`deliveries_shop_idx`, `deliveries_shop_id_idx`) are **NOT dropped in Stage 2A.** After this index is live, capture `EXPLAIN (ANALYZE)` for the `deliveries` list query on production-sized data; only if it confirms `deliveries_shop_created_idx` serves the `shop_id`-prefix lookups will a separate, later PR propose dropping the redundant index.
**Locking/downtime:** all `CONCURRENTLY`; `orders` build is longest — schedule off-peak; no blocking.
**Verify:** each `indisvalid = t`; `EXPLAIN (ANALYZE)` on `orders`/`expenses`/`deliveries` list queries shows `Index Scan` and no separate `Sort`.
**Row-violation risk:** none (all non-unique).

---

# STEP 3 — M-2A-02 (REVISED): `staff_time_entries` RLS + index

## 3.1 Access-model decision (revised for approval)

**Do NOT use the previously proposed `user_has_shop_access` (all active members) policy.** Proven unsafe below: an ordinary active `employee` member has access to the shop but must not see payroll/time data.

**Revised model for Stage 2A:** grant SELECT only to **owners and authorized managers** of the shop, via a new `user_can_manage_shop(shop_id)` helper (owner **or** manager, active). This matches the current application authorization (`staff.js` already gates on `requireRoles(['owner','manager'])`) and the privacy requirements:
- Owners/authorized managers → view all staff time entries for their shop. ✔
- Ordinary shop members (`employee`) and non-members → no access. ✔
- Pay/tax/contact/detailed time history remain private to management. ✔

**Employee "view only their own": DEFERRED (prerequisite missing).** See §3.3 — there is currently **no link** between `auth.users` and `staff`, so per-employee self-access cannot be expressed in RLS without a schema change. Employees do not access this endpoint today, so no capability is lost.

## 3.2 Roles / permission assumptions
- `shop_members.role` domain is **`owner | manager | employee`** (verified `CHECK` constraint) with `status` in `invited|active|suspended`; only `active` grants access.
- "Authorized manager" = `shop_members.role = 'manager'` with `status='active'`. (If a narrower "authorized manager" sub-designation is later required, it becomes an explicit permission flag in Stage 2B.)
- Helper is `SECURITY DEFINER` (like `user_is_shop_owner`) so it reliably reads `shop_members` regardless of that table's own RLS.
- Assumes `authenticated` has `SELECT` privilege on `staff_time_entries` (Supabase default). RLS then filters rows; service role continues to bypass for the app until Stage 2B.

## 3.3 Current relationship between `auth.users` and `staff` (documented)
- `staff` columns: `id, shop_id, name, email, phone, role, active, hourly_rate, hire_date, *_tax_rate, …` — **no `user_id`**, only FK `staff_shop_id_fkey → shops(id)`.
- `staff_time_entries` columns: `id, shop_id, staff_id, clock_in, clock_out, hours_worked, notes` — **no `user_id`**; FKs to `shops(id)` and `staff(id)`.
- `shop_members(user_id → auth.users, shop_id, role, status)` is the only link between an authenticated user and a shop.
- **Conclusion:** an authenticated user (`auth.uid()`) cannot be matched to a `staff` row today (`staff.email` may informally coincide but is not an enforced identity link). **Prerequisite for employee-self access (Stage 2B+):** add `staff.user_id uuid references auth.users(id)`, backfill/verify the mapping, then extend the policy with an `OR` branch:
  ```sql
  -- FUTURE (not in 2A): after staff.user_id exists and is backfilled
  USING (
    public.user_can_manage_shop(shop_id)
    OR staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  )
  ```

## 3.4 Exact SQL (revised)

**3A — helper + RLS + policy (transactional):**
```sql
BEGIN;
-- SECURITY DEFINER; complements user_is_shop_owner. Reused in Stage 2B. is_shop_member is untouched.
CREATE OR REPLACE FUNCTION public.user_can_manage_shop(target_shop_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_members
    WHERE shop_id = target_shop_id
      AND user_id = auth.uid()
      AND role IN ('owner','manager')
      AND status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.user_can_manage_shop(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.user_can_manage_shop(uuid) TO authenticated, service_role;

ALTER TABLE public.staff_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read staff time entries" ON public.staff_time_entries;
CREATE POLICY "managers read staff time entries"
  ON public.staff_time_entries
  FOR SELECT
  USING (public.user_can_manage_shop(shop_id));
COMMIT;
```
*Write policies remain deferred to Stage 2B (writes continue via service role), matching the `payments` precedent (RLS on, SELECT policy only).*

**3B — supporting index (outside transaction):**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_time_entries_shop_staff_idx
  ON public.staff_time_entries (shop_id, staff_id, clock_in DESC);
```

## 3.5 Rollback SQL
```sql
-- 3B
DROP INDEX CONCURRENTLY IF EXISTS public.staff_time_entries_shop_staff_idx;
-- 3A
BEGIN;
DROP POLICY IF EXISTS "managers read staff time entries" ON public.staff_time_entries;
ALTER TABLE public.staff_time_entries DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS public.user_can_manage_shop(uuid);
COMMIT;
```
*Disabling RLS reverts to the current (insecure) state — emergency reversal only.*

## 3.6 Locking / downtime
- `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, and function creation take brief `ACCESS EXCLUSIVE` catalog locks (milliseconds) on this one table/function only.
- The index uses `CONCURRENTLY` (no blocking).
- No app impact (service role bypasses RLS; `staff.js` unchanged in 2A).

## 3.7 Test cases + proof (executed on local dev inside a rolled-back transaction — nothing persisted)

Seeded a manager and an ordinary `employee` member on a shop plus one `staff_time_entries` row, applied the helper + policy, queried as each principal, then `ROLLBACK` (post-rollback `relrowsecurity = f`, confirming nothing persisted).

**Helper behavior (proof `user_has_shop_access` / `user_is_shop_owner` / `user_can_manage_shop` are correct):**

| Principal | `user_has_shop_access` | `user_is_shop_owner` | `user_can_manage_shop` |
|---|---|---|---|
| owner | t | t | t |
| manager | t | f | t |
| employee (ordinary member) | **t** | f | **f** |
| non-member | f | f | f |

**RLS visibility of `staff_time_entries` (rows returned):**

| Principal | Rows visible | Expected | Result |
|---|---|---|---|
| owner | 1 | all shop rows | ✅ |
| manager | 1 | all shop rows | ✅ |
| employee (ordinary member) | **0** | none | ✅ |
| non-member | 0 | none | ✅ |
| service_role (bypass) | 1 | all (app path) | ✅ |

The `employee`/manager rows prove the requirement precisely: an active member (`user_has_shop_access = t`) is correctly **denied** unless they are owner/manager (`user_can_manage_shop`). This is why the broad policy is rejected.

## 3.8 Proof that existing rows have valid `shop_id`
- Structural guarantee: `staff_time_entries.shop_id` is `NOT NULL` with FK `staff_time_entries_shop_id_fkey → shops(id)` (and `staff_id → staff(id)`), so an invalid/dangling `shop_id` cannot exist.
- Current data check (local): `total_rows=0, null_shop=0, orphan_shop=0, mismatch_staff_shop=0`.
- **Production pre-check to attach to the execution PR (read-only, expect all 0):**
```sql
SELECT
  (SELECT count(*) FROM public.staff_time_entries WHERE shop_id IS NULL) AS null_shop,
  (SELECT count(*) FROM public.staff_time_entries e
     LEFT JOIN public.shops s ON s.id=e.shop_id WHERE s.id IS NULL) AS orphan_shop,
  (SELECT count(*) FROM public.staff_time_entries e
     JOIN public.staff st ON st.id=e.staff_id WHERE e.shop_id <> st.shop_id) AS mismatch_staff_shop;
-- Required helper present:
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('user_is_shop_owner');  -- expect >=1
```
Rows do **not** need to satisfy a `WITH CHECK` (none added); the policy is a visibility filter, so no existing row is rejected.

---

# Tenancy note (per approved direction)
- `user_can_manage_shop` complements the approved `user_is_shop_owner` and will be reused by the Stage 2B function refactor (owner/manager gated endpoints: `settings`, `staff`, finance/payment actions).
- `is_shop_member` is **left in place** for Stage 2A; it will be deprecated only after all references are migrated and tested in Stage 2B.

---

# Production runbook (per step; each gated on founder approval, #10)

For each step, in order **M-2A-01 → M-2A-03 → M-2A-02**:
1. Run the read-only production pre-checks; attach output to the execution PR.
2. Apply the forward SQL on **staging** (production-sized seed) → run the step's verify checks (`indisvalid`, `EXPLAIN`, and for M-2A-02 the §3.7 principal tests) → record before/after p95 for affected endpoints.
3. Founder approval → apply to **production** in the off-peak window (order-critical: do not reorder).
4. Keep the step's rollback SQL ready; monitor error rates and query plans post-apply.
5. Proceed to the next step only after the previous step is verified.

**Deployment:** none required for any of the three migrations (DB-only). No frontend/function deploy in Stage 2A unless an unexpected compatibility issue forces code changes (none anticipated, since `service_role` bypasses RLS and the app path is unchanged).

# Explicitly NOT done
- No migration executed; no schema/data changed in any shared/production environment (local proof ran inside a rolled-back transaction).
- `deliveries(shop_id)` index not dropped (deferred pending evidence).
- No endpoint moved to user-JWT/RLS; `is_shop_member` not removed; no deploy.
