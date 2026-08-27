# Stage 2A — Execution, Rollback & Validation Checklists

Database-only. **No Netlify/frontend/function deployment.** Apply in order **M-2A-01 → M-2A-03 → M-2A-02 (03a → 03b → 03c)**. SQL files: `supabase/stage2a/`.

Because `service_role` bypasses RLS and every function currently uses it, these changes cause **no behavioral change** to the running app; they are foundations for Stage 2B.

---

## A. Production execution checklist

**Pre-flight (read-only)**
- [ ] Confirm maintenance/off-peak window (only the first `orders` concurrent index build is non-trivial on large data).
- [ ] Confirm helper `public.user_is_shop_owner(uuid)` exists (required by 03c).
- [ ] Run data-integrity pre-check (expect all `0`):
  ```sql
  SELECT
    (SELECT count(*) FROM public.staff_time_entries WHERE shop_id IS NULL) AS null_shop,
    (SELECT count(*) FROM public.staff_time_entries e LEFT JOIN public.shops s ON s.id=e.shop_id WHERE s.id IS NULL) AS orphan_shop,
    (SELECT count(*) FROM public.staff_time_entries e JOIN public.staff st ON st.id=e.staff_id WHERE e.shop_id<>st.shop_id) AS mismatch;
  ```
- [ ] Snapshot current indexes/RLS/columns (baseline for drift check).
- [ ] Ensure a DBA can run `CREATE INDEX CONCURRENTLY` (cannot be inside a transaction; not via a wrapping migration runner).

**Apply (in order)**
- [ ] `01_shop_members_user_id_index.up.sql` (outside txn) → verify `indisvalid`.
- [ ] `02_composite_indexes.up.sql` (outside txn, per statement) → verify 3 indexes `indisvalid`.
- [ ] `03a_prereq_columns.up.sql` (txn) → verify `staff.user_id`, `shop_members.can_view_all_timesheets` exist.
- [ ] `03b_staff_indexes.up.sql` (outside txn) → verify 3 indexes `indisvalid`.
- [ ] `03c_rls_policy.up.sql` (txn) → verify RLS on, policy present, function `security definer`.

**Post-apply**
- [ ] Run the validation checklist (§C).
- [ ] Confirm app health unchanged (`/api/health`, a sample authenticated call).
- [ ] Record timings + query plans for the completion report.

## B. Rollback checklist (reverse order)
- [ ] `03c_rls_policy.down.sql` (txn) — drops policy, disables RLS, drops function.
- [ ] `03b_staff_indexes.down.sql` (outside txn).
- [ ] `03a_prereq_columns.down.sql` (txn) — **DESTRUCTIVE**: only if no employee links/grants were set; otherwise stop and keep columns.
- [ ] `02_composite_indexes.down.sql` (outside txn).
- [ ] `01_shop_members_user_id_index.down.sql` (outside txn).
- [ ] Verify baseline restored (0 Stage 2A indexes, RLS off, columns/function gone, `deliveries(shop_id)` still present).
- Partial rollback guidance: prefer rolling back only `03c` if the only issue is the policy; keep additive indexes/columns (they are inert without the policy).

## C. Validation checklist
- [ ] All 7 indexes report `indisvalid = t` and `indisready = t`.
- [ ] `staff_time_entries.relrowsecurity = t`; exactly one SELECT policy `read own or authorized staff time entries`.
- [ ] `can_read_time_entry` is `SECURITY DEFINER`; `EXECUTE` limited to `authenticated`, `service_role` (PUBLIC revoked).
- [ ] `deliveries_shop_idx` / `deliveries_shop_id_idx` still present (retained per directive).
- [ ] Query-plan spot checks on production-sized data: `orders`/`expenses`/`deliveries` list queries use the new composite index (Index Scan, no Sort); `shop_members` `user_id` lookup uses `shop_members_user_id_status_idx`.
- [ ] RLS behavior (seed in a rolled-back transaction, query as each principal):
  - owner → all shop rows
  - manager with `can_view_all_timesheets=true` → all shop rows
  - manager without the grant → 0
  - employee linked via `staff.user_id` → only their own; cannot see a coworker's row
  - ordinary member → 0
  - non-member → 0
  - `service_role` → all (bypass)
- [ ] Idempotency: re-running `03a`/`03c` produces no error and no duplicate policy.
- [ ] Drift: final object definitions match `supabase/stage2a/*.up.sql`; no `INVALID` indexes.
