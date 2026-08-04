# Live schema snapshot runbook (P0-07A R4)

Read-only metadata report for comparing **staging** and **production** database structure to repository expectations.

**This runbook does not apply migrations.** It does not enable Community, touch Today, or deploy.

**No database has been contacted. The snapshot SQL has never been executed against staging, production, or any other database.**

## What this pack is

| File | Purpose |
|------|---------|
| `scripts/sql/florisyn-live-schema-snapshot.sql` | Manual READ ONLY SQL report (one JSON result) |
| `scripts/validate-schema-snapshot-sql.mjs` | Strict static safety validator (no database connection) |
| `tests/florisyn-live-schema-snapshot.test.js` | Focused safety suite |
| `npm run test:live-schema-snapshot` | Runs the focused suite |

## Exact transaction grammar

The validator requires exactly three top-level statements:

1. `BEGIN READ ONLY`
2. One `WITH … SELECT …` snapshot statement (the metadata query)
3. Final `ROLLBACK`

No additional `BEGIN` / `START TRANSACTION`, no `COMMIT` / `END`, and no statements after `ROLLBACK`.

## Safety contract

The snapshot SQL:

- Opens `BEGIN READ ONLY`
- Uses a single `WITH` / `SELECT` CTE query
- Ends with `ROLLBACK`
- Reads PostgreSQL catalogs / `information_schema` / `storage.buckets` configuration only
- Does **not** read table row data, `auth.users` rows, `storage.objects`, Vault/secrets, tokens, or function bodies
- Collects **only filtered `search_path` configuration** from `proconfig` via exactly one **structural** approved extraction equivalent to:
  ```sql
  COALESCE(
    (
      SELECT jsonb_agg(cfg ORDER BY cfg)
      FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg LIKE 'search_path=%'
    ),
    '[]'::jsonb
  )
  ```
  Whitespace may vary, but the `WHERE` clause must belong to **the same** scalar subquery as the `unnest(...)` — a global or unrelated `WHERE` is rejected. Any second executable `proconfig` reference is rejected. Complete `proconfig` / `all_config` dumps are forbidden.
- Contains **no capture timestamp** in the JSON payload (`captured_at` / `NOW()` removed). The secure artifact **filename** records UTC capture time externally.
- Reports `transaction_read_only` from `current_setting('transaction_read_only') = 'on'` (real boolean), not a hardcoded `true`.
- Function calls are **allowlisted** as **unqualified** names only (JSON/catalog helpers + `current_setting`). Schema-qualified function calls (e.g. `pg_catalog.pg_read_file(...)`, `public.jsonb_agg(...)`) are **forbidden**.
- Every relation source is inspected by a **fail-closed token-aware walker**:
  - Relations immediately after `FROM` and `JOIN`
  - Comma-separated relations inside a `FROM` list
  - Relations inside nested subqueries, CTE bodies, and `LATERAL` sources
  - PostgreSQL **`WITH ORDINALITY`** after table-functions, plus optional `AS` / bare alias / alias column-definition lists `(…)`
  - **Unknown FROM-item syntax fails closed** (`parseErrors` → validation failure); the walker does not silently stop mid-item
- Relations must be allowlisted (catalog / `information_schema` / `storage.buckets`) or declared CTE names. Application, business, `public.*`, `auth.*`, and non-bucket `storage.*` relations are rejected.
- CTE names cannot shadow allowlisted catalog relations (full allowlist entries and schema prefixes such as `storage` / `information_schema` / `pg_proc`).
- Double-quoted identifiers in executable SQL are **forbidden** (closes quoted-identifier bypasses). Harmless quotes inside comments or string literals remain accepted.

Validate locally before any hosted run:

```bash
node scripts/validate-schema-snapshot-sql.mjs
npm run test:live-schema-snapshot
```

## Metadata included

One JSON object (`florisyn_live_schema_snapshot`) with:

- Non-system schemas
- Tables / views
- Columns
- RLS enabled + forced flags
- Policies
- Table grants
- Function/RPC signatures (no source)
- `SECURITY DEFINER` flag
- Filtered `search_path_config` only
- Function `EXECUTE` privileges, including `specific_name` (the `information_schema` overload identifier), routine schema/name, grantee, privilege, grantable
- Triggers
- Constraints
- Indexes
- Storage **bucket configuration** rows from `storage.buckets` (never `storage.objects`)
- Storage bucket catalog existence/columns via `information_schema`
- Whether `supabase_migrations` / `schema_migrations` exists (and its column metadata)

## Owner procedure (staging, then production)

Do **not** run until Technical Director approval.

1. Confirm backup / PITR posture (see `BACKUP-RECOVERY.md`).
2. Open the target **Supabase** project SQL editor (or `psql`) with a role that can read catalogs. The pack expects a Supabase project with `storage.buckets` present.
3. Paste **only** `scripts/sql/florisyn-live-schema-snapshot.sql`.
4. Run it. Expect a single JSON row; the script ends with `ROLLBACK`.
5. Save the JSON to a secure artifact path whose **filename** includes environment + UTC capture time, for example:
   - `florisyn-schema-snapshot-staging-2026-08-01T17-00-00Z.json`
   - `florisyn-schema-snapshot-production-2026-08-01T17-05-00Z.json`
6. Do not paste customer/business row dumps into tickets. This report is metadata-only by design.
7. Repeat for the second environment.
8. Deliver both artifacts to Technical Director for drift review.

### Known intentional limit

Listing `supabase_migrations.schema_migrations` **version rows** would require dynamic SQL when the table is absent (parse-time dependency). This pack forbids `EXECUTE`/`DO`, so migration history is reported as **existence + column metadata only**.

## What not to do

- Do not remove `ROLLBACK`
- Do not convert the session to read/write
- Do not run any migration file from `supabase/`
- Do not query `storage.objects`, `auth.*`, application/`public.*` tables, or Vault
- Do not introduce double-quoted identifiers or schema-qualified function calls into the snapshot SQL
- Do not request or paste credentials into chat logs

## Local engineering checks

```bash
npm run test:live-schema-snapshot
npm test
npm run check
git status --porcelain --untracked-files=all -- supabase
```

No hosted connection is required for these checks.
