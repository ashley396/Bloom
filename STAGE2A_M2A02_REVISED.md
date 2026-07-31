# Stage 2A — M-2A-02 (Revised v3): staff_time_entries privacy model

**Status:** For founder approval. **Nothing executed, no DB modified, no deploy.** Supersedes STEP 3 of `STAGE2A_RUNBOOK.md`. All proof below was produced on the local dev DB inside a **single rolled-back transaction** (post-rollback confirmed: RLS off, no new columns) — no migration was executed.

**Approved execution order (unchanged):** 1) M-2A-01 → 2) M-2A-03 → 3) **this revised M-2A-02** (after approval). `deliveries(shop_id)` index not removed.

---

## 1. Requirements → design mapping

| Florisyn requirement | Design element |
|---|---|
| 1. Owners + **explicitly authorized** managers view all shop entries | `user_is_shop_owner(shop_id)` OR `shop_members.can_view_all_timesheets = true` (explicit grant) |
| 2. Employees view **only their own** unless separately authorized | `staff.user_id = auth.uid()` self-link; broader access only via the explicit grant |
| 3. Ordinary members/designers/drivers/others do **not** auto-see coworkers | No blanket member access; access requires owner / explicit grant / own-row link |
| 4. Payroll, pay rates, tax, contact, detailed time history private | Detailed time history covered here; **pay/tax/contact live on `staff`** → companion restriction in §9 |
| 5. Non-members receive no rows | Policy returns false for non-members |

The previously proposed broad `user_has_shop_access` policy is **not used** (an ordinary active member is authenticated but unauthorized — proven in §6).

---

## 2. How `auth.users` is linked to `staff` (current vs required)

**Current:** there is **no link.** `staff` has only `staff_shop_id_fkey → shops(id)`; neither `staff` nor `staff_time_entries` has a `user_id`. The sole user↔shop link is `shop_members(user_id → auth.users, shop_id, role, status)`. `staff.email` may informally coincide with a login email but is not an enforced identity.

**Required for safe employee self-access (prerequisite, §4):** add `staff.user_id uuid → auth.users(id)`, so a time entry's owning employee can be matched to `auth.uid()` via `staff_time_entries.staff_id → staff.user_id`.

---

## 3. Current role & permission fields in the schema

- `shop_members.role` — CHECK domain **`owner | manager | employee`**; `shop_members.status` — `invited | active | suspended` (only `active` grants access). **No permission/authorization columns exist today.**
- `staff.role` — free text describing the employee (e.g., `employee`, and could hold `designer`/`driver`); **not** linked to a login user and **not** the authorization source.
- Helpers present: `user_has_shop_access` (active membership), `user_is_shop_owner` (active owner), `is_shop_member` (status-agnostic; retained, not used here).

Because there is no permission column and no user↔staff link, both are added as prerequisites (§4).

---

## 4. Prerequisite schema changes (M-2A-02a)

**4a — columns (transactional):**
```sql
BEGIN;
-- Link an employee record to a login user (nullable → fail-closed until linked).
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Explicit, separate authorization to view ALL timesheets (owner-independent).
ALTER TABLE public.shop_members
  ADD COLUMN IF NOT EXISTS can_view_all_timesheets boolean NOT NULL DEFAULT false;
COMMIT;
```

**4b — indexes (outside transaction, CONCURRENTLY):**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_user_id_idx
  ON public.staff (user_id) WHERE user_id IS NOT NULL;
-- One login user maps to at most one staff record per shop.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS staff_shop_user_unique
  ON public.staff (shop_id, user_id) WHERE user_id IS NOT NULL;
-- Approved supporting index for staff_time_entries lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_time_entries_shop_staff_idx
  ON public.staff_time_entries (shop_id, staff_id, clock_in DESC);
```

**Backfill = fail-closed (default).** `staff.user_id` starts `NULL`; employees see nothing until an owner links them (a Stage 2B linking UI). Email-based auto-linking is **not** part of the migration (emails are unverified and may be ambiguous). An **optional, per-shop, manually reviewed** helper is provided for later use only:
```sql
-- OPTIONAL, run manually per shop after review; links only unambiguous single email matches.
UPDATE public.staff s SET user_id = m.user_id
FROM public.shop_members m JOIN auth.users u ON u.id = m.user_id
WHERE s.shop_id = m.shop_id AND s.user_id IS NULL
  AND lower(u.email) = lower(s.email)
  AND (SELECT count(*) FROM public.staff s2
        WHERE s2.shop_id = s.shop_id AND lower(s2.email) = lower(s.email)) = 1;
```

---

## 5. Authorization helper + RLS policy (M-2A-02b, transactional)

```sql
BEGIN;
CREATE OR REPLACE FUNCTION public.can_read_time_entry(target_shop_id uuid, target_staff_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.user_is_shop_owner(target_shop_id)                       -- owner: all
    OR EXISTS (                                                     -- explicitly authorized (e.g., manager granted)
      SELECT 1 FROM public.shop_members
      WHERE shop_id = target_shop_id AND user_id = auth.uid()
        AND status = 'active' AND can_view_all_timesheets = true
    )
    OR EXISTS (                                                     -- employee: own linked entries only
      SELECT 1 FROM public.staff
      WHERE id = target_staff_id AND shop_id = target_shop_id
        AND user_id = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION public.can_read_time_entry(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_read_time_entry(uuid,uuid) TO authenticated, service_role;

ALTER TABLE public.staff_time_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own or authorized staff time entries" ON public.staff_time_entries;
CREATE POLICY "read own or authorized staff time entries"
  ON public.staff_time_entries
  FOR SELECT
  USING (public.can_read_time_entry(shop_id, staff_id));
COMMIT;
```
`SECURITY DEFINER` (like `user_is_shop_owner`) so the checks read `shop_members`/`staff` reliably regardless of those tables' own RLS; `auth.uid()` still resolves to the calling user. Reuses the approved `user_is_shop_owner`; `is_shop_member` untouched. Write policies remain deferred (writes via service role until Stage 2B), matching the `payments` precedent.

---

## 6. Test cases (proof — executed in a rolled-back transaction; nothing persisted)

Seeded on one shop: an authorized manager (`can_view_all_timesheets=true`), an unauthorized manager, an employee linked via `staff.user_id`, an ordinary member (no link), and two time entries (the employee's + a coworker's).

**Helper behavior — proof `user_has_shop_access` / `user_is_shop_owner` behave correctly:**

| Principal | `user_has_shop_access` | `user_is_shop_owner` |
|---|---|---|
| owner | t | t |
| manager (authorized) | t | f |
| employee | t | f |
| ordinary member | t | f |
| non-member | **f** | f |

**RLS visibility of `staff_time_entries` (shop has 2 entries: employee's + coworker's):**

| Test case | total rows visible | sees coworker's row | Expected | Result |
|---|---|---|---|---|
| **Owner** | 2 (all) | yes | all | ✅ |
| **Manager — explicitly authorized** | 2 (all) | yes | all | ✅ |
| **Manager — not authorized** | 0 | no | restricted | ✅ (proves "explicit") |
| **Employee viewing own entries** | 1 (own) | no | own only | ✅ |
| **Employee viewing coworker entries** | 0 (coworker) | no | denied | ✅ |
| **Ordinary member** | 0 | no | none | ✅ |
| **Non-member** | 0 | — | none | ✅ |
| service_role (app path, bypass) | 2 | — | all | ✅ |

Requirements 1–5 all satisfied. The unauthorized-manager and ordinary-member results confirm no coworker exposure without an explicit grant.

---

## 7. Proof all existing `staff_time_entries` have valid `shop_id`
- Structural guarantee: `shop_id` is `NOT NULL` with FK `staff_time_entries_shop_id_fkey → shops(id)` (and `staff_id → staff(id)`), so invalid/dangling `shop_id` cannot exist.
- Current check (local): `total=0, null_shop=0, orphan_shop=0, mismatch_staff_shop=0`.
- **Production pre-check (read-only; attach to execution PR; expect all 0):**
```sql
SELECT
  (SELECT count(*) FROM public.staff_time_entries WHERE shop_id IS NULL) AS null_shop,
  (SELECT count(*) FROM public.staff_time_entries e
     LEFT JOIN public.shops s ON s.id=e.shop_id WHERE s.id IS NULL) AS orphan_shop,
  (SELECT count(*) FROM public.staff_time_entries e
     JOIN public.staff st ON st.id=e.staff_id WHERE e.shop_id <> st.shop_id) AS mismatch_staff_shop;
```

---

## 8. Exact rollback SQL
```sql
-- 5 (policy/RLS/helper)
BEGIN;
DROP POLICY IF EXISTS "read own or authorized staff time entries" ON public.staff_time_entries;
ALTER TABLE public.staff_time_entries DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS public.can_read_time_entry(uuid,uuid);
COMMIT;
-- 4b (indexes)
DROP INDEX CONCURRENTLY IF EXISTS public.staff_time_entries_shop_staff_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.staff_shop_user_unique;
DROP INDEX CONCURRENTLY IF EXISTS public.staff_user_id_idx;
-- 4a (columns) — DESTRUCTIVE: only for full reversal BEFORE any linking/grants are set,
--                since dropping loses staff↔user links and timesheet grants.
BEGIN;
ALTER TABLE public.shop_members DROP COLUMN IF EXISTS can_view_all_timesheets;
ALTER TABLE public.staff DROP COLUMN IF EXISTS user_id;
COMMIT;
```
Disabling RLS reverts to the current insecure state (emergency only). Prefer rolling back §5 first if a problem appears; keep the additive columns unless a full reversal is required.

---

## 9. Companion requirement for full #4 compliance (`staff` table) — for founder decision
Requirement #4 also covers **pay rates, tax, and contact info**, which live on the **`staff`** table, not `staff_time_entries`. Today `staff` has a broad RLS policy `"staff shop access" USING is_shop_member(shop_id) FOR ALL` — i.e., any member could read pay/tax/contact once endpoints move to user-JWT (2B). To fully meet #4, a companion change should tighten `staff` reads to the same model:
```sql
-- COMPANION (recommended; approve to bundle with M-2A-02 or sequence in 2B)
BEGIN;
DROP POLICY IF EXISTS "staff shop access" ON public.staff;   -- replace broad ALL policy
CREATE POLICY "staff read: managers or self" ON public.staff
  FOR SELECT USING (
    public.user_is_shop_owner(shop_id)
    OR EXISTS (SELECT 1 FROM public.shop_members
        WHERE shop_id = staff.shop_id AND user_id = auth.uid()
          AND status='active' AND can_view_all_timesheets = true)
    OR user_id = auth.uid()                                   -- an employee may read their own record
  );
-- write policies (owner/manager) to be defined with the Stage 2B staff.js JWT refactor
COMMIT;
```
**Note:** this changes `staff` write semantics (the old policy was `FOR ALL`); it must land together with the Stage 2B `staff.js` move to user-JWT so service-role writes are unaffected in the interim. Flagged separately so M-2A-02 (staff_time_entries) can proceed independently if preferred.

---

## 10. Locking / downtime, and app impact
- Column adds and RLS/policy/function creation take brief `ACCESS EXCLUSIVE` catalog locks (ms). `NOT NULL DEFAULT false` on `shop_members` is a metadata-only default in modern Postgres (no table rewrite).
- All index builds use `CONCURRENTLY` (online).
- **No app impact in 2A:** `staff.js` still uses the service role (bypasses RLS); this is defense-in-depth + prerequisites for Stage 2B.

## 11. Data-violation analysis (existing rows vs new policy/constraints)
- `staff.user_id` nullable, default null → no existing row violates; `ON DELETE SET NULL` is safe.
- `staff_shop_user_unique` partial unique index → safe now (all `user_id` NULL); **if backfilling later, verify uniqueness first** (the optional backfill in §4 enforces single-match).
- `shop_members.can_view_all_timesheets NOT NULL DEFAULT false` → existing rows become `false` (fail-closed; nobody newly authorized).
- RLS `USING` is a visibility filter with no `WITH CHECK` → **no existing row rejected**; non-owners simply see fewer rows (intended).

## 12. Execution & gates
Apply in order **M-2A-01 → M-2A-03 → M-2A-02** (this doc): 4a → 4b → 5, each verified on staging (run §6 principal tests + `indisvalid`) before founder-approved production apply. **No migration executed yet; no deployment.**
