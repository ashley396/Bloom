# Stage 2A — Completion Report

**Outcome:** All approved Stage 2A migrations executed, validated, and rollback-verified. Final state = Stage 2A applied. **No frontend/function deployment performed** (DB-only, as approved).

**Execution environment:** the Supabase Postgres instance available to this environment (the project's dev/rehearsal database). A separate cloud production instance is not reachable from this agent; the same versioned files (`supabase/stage2a/`) and the `STAGE2A_CHECKLISTS.md` procedure are ready for the team to run against production. All results below are from the rehearsal execution and validate the files/procedure end-to-end.

---

## 1. Migrations executed (in approved order)

| # | Migration | Objects | Result |
|---|---|---|---|
| 1 | M-2A-01 `01_shop_members_user_id_index` | `shop_members_user_id_status_idx` | ✅ |
| 2 | M-2A-03 `02_composite_indexes` | `orders_shop_created_idx`, `expenses_shop_date_idx`, `deliveries_shop_created_idx` | ✅ |
| 3a | M-2A-02a `03a_prereq_columns` | `staff.user_id`, `shop_members.can_view_all_timesheets` | ✅ |
| 3b | M-2A-02b `03b_staff_indexes` | `staff_user_id_idx`, `staff_shop_user_unique`, `staff_time_entries_shop_staff_idx` | ✅ |
| 3c | M-2A-02c `03c_rls_policy` | `can_read_time_entry()`, RLS enable, SELECT policy | ✅ |

`deliveries(shop_id)` indexes retained per directive. `is_shop_member` untouched. Staff-table authorization changes intentionally excluded (moved to Stage 2B).

## 2. Execution time (rehearsal DB; per statement)

| Migration | Time |
|---|---|
| M-2A-01 (1 index, CONCURRENTLY) | ~2.8 ms |
| M-2A-03 (3 indexes) | ~4.7 ms total |
| M-2A-02a (2 columns) | ~2.9 ms |
| M-2A-02b (3 indexes; first build ~57 ms) | ~60 ms total |
| M-2A-02c (function + RLS + policy) | ~3.4 ms |

Times are on a small rehearsal dataset. On production the concurrent index builds scale with table size (notably `orders`); they run **online** (no blocking). No statement required a table rewrite (`ADD COLUMN ... DEFAULT false` is metadata-only in modern Postgres).

## 3. Indexes created (final definitions, all `indisvalid = t`)
```
shop_members_user_id_status_idx    ON public.shop_members (user_id, status)
orders_shop_created_idx            ON public.orders (shop_id, created_at DESC)
expenses_shop_date_idx             ON public.expenses (shop_id, expense_date DESC)
deliveries_shop_created_idx        ON public.deliveries (shop_id, created_at DESC)
staff_user_id_idx                  ON public.staff (user_id) WHERE user_id IS NOT NULL
staff_shop_user_unique  UNIQUE     ON public.staff (shop_id, user_id) WHERE user_id IS NOT NULL
staff_time_entries_shop_staff_idx  ON public.staff_time_entries (shop_id, staff_id, clock_in DESC)
```

## 4. RLS enabled
- `staff_time_entries`: `relrowsecurity = t`; one SELECT policy `read own or authorized staff time entries` → `USING (can_read_time_entry(shop_id, staff_id))`.
- `can_read_time_entry(uuid,uuid)`: `SECURITY DEFINER`; `PUBLIC` execute revoked; granted to `authenticated`, `service_role`. (On the rehearsal DB, a pre-existing blanket default-privilege also left `anon` with EXECUTE; the migration's explicit grant is production-correct and the function fails closed for `anon` since `auth.uid()` is null → returns false.)
- Writes to `staff_time_entries` remain via service role until Stage 2B (matches the `payments` precedent).

## 5. Query-plan improvements (measured on seeded volume, rolled back)

**`orders` list — `WHERE shop_id=? ORDER BY created_at DESC LIMIT 50` (50,000 rows):**
| | Plan | Execution time |
|---|---|---|
| Before (no composite idx) | Seq Scan + top-N heapsort | **28.6 ms** |
| After (`orders_shop_created_idx`) | Index Scan (no sort) | **0.047 ms** |

≈ **600× faster**; eliminates the full scan and the sort.

**`shop_members` — `WHERE user_id=? AND status='active'` (20,000 rows; runs on every authenticated request):**
| | Plan | Execution time |
|---|---|---|
| Before | Seq Scan (Rows Removed by Filter: 20,002) | **0.823 ms** |
| After (`shop_members_user_id_status_idx`) | Index Scan | **0.017 ms** |

≈ **48× faster** at 20k rows; the gap widens as membership grows toward Stage-2 scale. `expenses`/`deliveries` composite indexes behave like `orders` (index scan, no sort).

## 6. Validation results (RLS behavior)

Seeded principals on one shop with two time entries (an employee's + a coworker's), executed inside a rolled-back transaction against the live policy:

| Principal | Rows visible | Sees coworker | Requirement | Result |
|---|---|---|---|---|
| Owner | 2 (all) | yes | #1 | ✅ |
| Manager — explicitly authorized (`can_view_all_timesheets=true`) | 2 (all) | yes | #1 | ✅ |
| Manager — not authorized | 0 | no | #1/#3 | ✅ |
| Employee — own entries | 1 (own) | no | #2 | ✅ |
| Employee — coworker entries | 0 | no | #3 | ✅ |
| Ordinary member | 0 | no | #3 | ✅ |
| Non-member | 0 | — | #5 | ✅ |
| service_role (bypass) | 2 | — | app path | ✅ |

Helper behavior: `user_has_shop_access` = true for all members / false for non-member; `user_is_shop_owner` = true only for the owner. All five Florisyn privacy requirements satisfied.

## 7. Rollback verification
Executed all `*.down.sql` in reverse order (`03c → 03b → 03a → 02 → 01`) against the applied state:
- Post-rollback: `stage2a_idx = 0`, `staff_time_entries.relrowsecurity = f`, Stage 2A columns = 0, `can_read_time_entry` = absent, `deliveries(shop_id)` still present → **baseline fully restored**.
- Re-applied all `*.up.sql` forward → final state restored (`7 indexes`, RLS on, 1 policy).
- Both directions verified independently; rollback timings ~0.1–2.4 ms per statement.

## 8. Schema-drift / integrity checks
- Idempotency: re-running `03a` and `03c` produced no errors and no duplicate policy (`policy_count = 1`).
- No `INVALID`/not-ready indexes after apply.
- Final object definitions match `supabase/stage2a/*.up.sql` exactly.
- `staff_time_entries.shop_id` validity: `NOT NULL` + FK to `shops(id)`; integrity check `null_shop=0, orphan_shop=0, mismatch_staff_shop=0`.

## 9. Remaining Stage 2B work (do not start until Stage 2A validated + founder approval)
- Introduce request-scoped **user-JWT client** + shared `authorize()`; flip endpoints per the approved function access matrix from service-role to **user JWT + RLS** (table-by-table, each behind isolation tests).
- **Staff-table authorization** (deferred here): replace the broad `is_shop_member` read policy on `public.staff` with owner/authorized/self read + owner-manager writes, landed with the `staff.js` JWT rewrite (covers pay/tax/contact — requirement #4).
- Employee self-service enablement: owner UI to link `staff.user_id` (fail-closed today); optional reviewed email backfill.
- Tenancy convergence: standardize policies on `user_has_shop_access`/`user_is_shop_owner`; migrate then **deprecate `is_shop_member`** after all references are updated/tested.
- Consistent write policies for `staff_time_entries` (clock in/out) once the endpoint uses user-JWT.
- Then Stage 2 later phases: async (Queues/pgmq), rate limiting, monitoring, remaining audit items.

## 10. Approval gate
Stage 2A is complete and validated on the rehearsal database. **Requesting founder approval** to (a) run the same files/checklist against production and (b) begin Stage 2B. No Stage 2B work has started.
