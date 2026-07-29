# Stage 2A migration files

Database-only migrations approved for Stage 2A. **Apply in this exact order; roll back in reverse.**
Index files use `CREATE/DROP INDEX CONCURRENTLY` and **must not** run inside a transaction.

| Order | Forward | Rollback | Txn? |
|---|---|---|---|
| 1 | `01_shop_members_user_id_index.up.sql` | `01_..._index.down.sql` | No (CONCURRENTLY) |
| 2 | `02_composite_indexes.up.sql` | `02_composite_indexes.down.sql` | No (CONCURRENTLY) |
| 3a | `03a_prereq_columns.up.sql` | `03a_prereq_columns.down.sql` | Yes |
| 3b | `03b_staff_indexes.up.sql` | `03b_staff_indexes.down.sql` | No (CONCURRENTLY) |
| 3c | `03c_rls_policy.up.sql` | `03c_rls_policy.down.sql` | Yes |

Execution/rollback/validation checklists: `../../STAGE2A_CHECKLISTS.md`.
Results of the rehearsal execution: `../../STAGE2A_COMPLETION_REPORT.md`.

The existing `deliveries(shop_id)` indexes are intentionally retained (founder directive).
`03a` rollback is destructive (drops identity/permission columns) — emergency full-reversal only.
