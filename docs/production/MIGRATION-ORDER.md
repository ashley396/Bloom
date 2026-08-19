# Canonical migration order

Status: review only; do not apply to production without Ashley's approval.

## Executable chain

`supabase/migrations/` contains exactly five uniquely versioned migrations:

1. `20260804000000_greenfield_baseline.sql` — empty projects only
2. `20260804171338_p0_09d_function_acl_hardening.sql` — forward ACL reconciliation
3. `20260804185015_p0_10_atomic_order_create.sql` — forward atomic-order boundary
4. `20260804205339_p0_12_closed_beta_tenant_isolation.sql` — closed-beta grants and tenant isolation
5. `20260804223000_p0_13_policy_consolidation.sql` — exact policy set and atomic onboarding/add-store boundaries
6. `20260804224500_p0_14_onboarding_convergence.sql` — complete Auth-triggered default shops with settings, hours, subscription, and AI profile
7. `20260805154819_p0_19_refund_idempotency.sql` — reserve and complete Stripe refunds atomically with tenant-scoped idempotency

The greenfield baseline is generated from the reviewed sources declared in
`scripts/build-canonical-baseline.mjs`. Regenerate it with
`npm run db:baseline:build` and verify it with `npm run db:baseline:check`.
Never edit the materialized baseline by hand.

## Historical SQL preservation

Historical files formerly mixed into the executable directory are preserved
unchanged in `supabase/legacy_migrations/`. Root-level versioned SQL remains
outside the executable directory and is consumed only by the baseline generator.

The following files are preserved but intentionally excluded:

- `marketplace_verification_schema.sql` — superseded
- `20260729_phase2a_a2_staff_time_entries_rls_v1.sql` — Staff A2 paused
- `20260730_foundation_daily_loop_v1_rollback.sql` — rollback SQL is never forward-applied
- `supabase/schema.sql` — conflicts with the canonical foundation shape

The sole hosted migration identity remains `20260727 / marketplace_security_hardening_v1`.
Its source is preserved byte-for-byte in the legacy archive.

## Empty staging procedure

1. Confirm the target is the isolated Florisyn Staging project and contains no
   application data.
2. Confirm Community remains disabled.
3. Apply the executable chain in timestamp order.
4. Run schema-contract, object-grant, RLS, two-shop, rollback, and concurrency checks.
5. Recreate the empty target and repeat the full process a second time.
6. Compare both schema fingerprints; any difference is a failure.

## Production reconciliation boundary

The baseline must never be executed against the existing production database.
Production has substantial schema state outside its one-row migration ledger.
A separately reviewed, forward-only reconciliation package under
`supabase/production_reconciliation/` must first prove object-by-object
equivalence with the greenfield result. Only after that proof may the baseline
and P0 versions be reconciled in migration history. P0-13 must follow P0-12 so
the legacy policy inventory is replaced once with the reviewed 28-policy set.
A normal
`supabase db push` is prohibited
until this procedure is approved and rehearsed.

## Recovery

- Stop on the first failed statement or verification.
- For isolated staging, recreate the empty environment and replay the chain.
- For production, use verified backup/PITR and the approved rollback authority.
- Never apply a historical `DOWN` or rollback SQL file as a forward migration.
