-- Florisyn P0-07A — Live schema snapshot (READ ONLY metadata report)
-- Manual owner run against staging/production AFTER Technical Director approval.
-- Returns one deterministic JSON object. Never reads row data, secrets, or function bodies.
--
-- Safety contract:
--   * Explicit READ ONLY transaction
--   * SELECT/CTE only
--   * Ends with ROLLBACK
--   * Catalog / information_schema / storage.buckets config only

BEGIN READ ONLY;

WITH
params AS (
  SELECT
    ARRAY[
      'pg_catalog',
      'information_schema',
      'pg_toast',
      'pg_temp_1',
      'pg_toast_temp_1'
    ]::text[] AS excluded_schemas
),

schemas AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', n.nspname,
        'owner', pg_get_userbyid(n.nspowner)
      )
      ORDER BY n.nspname
    ),
    '[]'::jsonb
  ) AS data
  FROM pg_namespace n
  CROSS JOIN params p
  WHERE n.nspname <> ALL (p.excluded_schemas)
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND n.nspname NOT LIKE 'pg_toast_temp_%'
),

tables AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', c.table_schema,
        'table_name', c.table_name,
        'table_type', c.table_type
      )
      ORDER BY c.table_schema, c.table_name
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.tables c
  CROSS JOIN params p
  WHERE c.table_schema <> ALL (p.excluded_schemas)
    AND c.table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN', 'LOCAL TEMPORARY')
),

columns AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', col.table_schema,
        'table_name', col.table_name,
        'column_name', col.column_name,
        'ordinal_position', col.ordinal_position,
        'data_type', col.data_type,
        'udt_name', col.udt_name,
        'is_nullable', col.is_nullable,
        'column_default', col.column_default,
        'character_maximum_length', col.character_maximum_length,
        'numeric_precision', col.numeric_precision,
        'numeric_scale', col.numeric_scale
      )
      ORDER BY col.table_schema, col.table_name, col.ordinal_position, col.column_name
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.columns col
  CROSS JOIN params p
  WHERE col.table_schema <> ALL (p.excluded_schemas)
),

rls AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', n.nspname,
        'table_name', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity
      )
      ORDER BY n.nspname, c.relname
    ),
    '[]'::jsonb
  ) AS data
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN params p
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname <> ALL (p.excluded_schemas)
    AND n.nspname NOT LIKE 'pg_temp_%'
),

policies AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', pol.schemaname,
        'table_name', pol.tablename,
        'policy_name', pol.policyname,
        'permissive', pol.permissive,
        'roles', to_jsonb(pol.roles),
        'command', pol.cmd,
        'qual', pol.qual,
        'with_check', pol.with_check
      )
      ORDER BY pol.schemaname, pol.tablename, pol.policyname, pol.cmd
    ),
    '[]'::jsonb
  ) AS data
  FROM pg_policies pol
  CROSS JOIN params p
  WHERE pol.schemaname <> ALL (p.excluded_schemas)
),

table_grants AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', g.table_schema,
        'table_name', g.table_name,
        'grantee', g.grantee,
        'privilege_type', g.privilege_type,
        'is_grantable', g.is_grantable
      )
      ORDER BY g.table_schema, g.table_name, g.grantee, g.privilege_type
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.role_table_grants g
  CROSS JOIN params p
  WHERE g.table_schema <> ALL (p.excluded_schemas)
),

functions AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', n.nspname,
        'function_name', p.proname,
        'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'result_type', pg_get_function_result(p.oid),
        'language', l.lanname,
        'kind', p.prokind,
        'security_definer', p.prosecdef,
        'leakproof', p.proleakproof,
        'volatile', CASE p.provolatile
          WHEN 'i' THEN 'IMMUTABLE'
          WHEN 's' THEN 'STABLE'
          ELSE 'VOLATILE'
        END,
        'search_path_config', COALESCE(
          (
            SELECT jsonb_agg(cfg ORDER BY cfg)
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
            WHERE cfg LIKE 'search_path=%'
          ),
          '[]'::jsonb
        )
      )
      ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    ),
    '[]'::jsonb
  ) AS data
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  CROSS JOIN params pms
  WHERE n.nspname <> ALL (pms.excluded_schemas)
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND p.prokind IN ('f', 'p', 'w')
),

function_execute_privileges AS (
  -- specific_name is the information_schema overload identifier for the routine.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'specific_name', r.specific_name,
        'schema_name', r.routine_schema,
        'routine_name', r.routine_name,
        'grantee', r.grantee,
        'privilege_type', r.privilege_type,
        'is_grantable', r.is_grantable
      )
      ORDER BY r.routine_schema, r.routine_name, r.specific_name, r.grantee, r.privilege_type
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.routine_privileges r
  CROSS JOIN params p
  WHERE r.routine_schema <> ALL (p.excluded_schemas)
    AND r.privilege_type = 'EXECUTE'
),

triggers AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'trigger_schema', t.trigger_schema,
        'trigger_name', t.trigger_name,
        'event_object_schema', t.event_object_schema,
        'event_object_table', t.event_object_table,
        'event_manipulation', t.event_manipulation,
        'action_timing', t.action_timing,
        'action_orientation', t.action_orientation,
        'action_statement', t.action_statement
      )
      ORDER BY t.trigger_schema, t.event_object_schema, t.event_object_table, t.trigger_name, t.event_manipulation
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.triggers t
  CROSS JOIN params p
  WHERE t.trigger_schema <> ALL (p.excluded_schemas)
    AND t.event_object_schema <> ALL (p.excluded_schemas)
),

constraints AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', tc.table_schema,
        'table_name', tc.table_name,
        'constraint_name', tc.constraint_name,
        'constraint_type', tc.constraint_type,
        'is_deferrable', tc.is_deferrable,
        'initially_deferred', tc.initially_deferred
      )
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type
    ),
    '[]'::jsonb
  ) AS data
  FROM information_schema.table_constraints tc
  CROSS JOIN params p
  WHERE tc.table_schema <> ALL (p.excluded_schemas)
),

indexes AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', ni.nspname,
        'table_name', ct.relname,
        'index_name', ci.relname,
        'is_unique', ix.indisunique,
        'is_primary', ix.indisprimary,
        'index_definition', pg_get_indexdef(ci.oid)
      )
      ORDER BY ni.nspname, ct.relname, ci.relname
    ),
    '[]'::jsonb
  ) AS data
  FROM pg_index ix
  JOIN pg_class ci ON ci.oid = ix.indexrelid
  JOIN pg_class ct ON ct.oid = ix.indrelid
  JOIN pg_namespace ni ON ni.oid = ct.relnamespace
  CROSS JOIN params p
  WHERE ni.nspname <> ALL (p.excluded_schemas)
    AND ni.nspname NOT LIKE 'pg_temp_%'
    AND ct.relkind IN ('r', 'p', 'm')
),

storage_bucket_catalog AS (
  SELECT jsonb_build_object(
    'storage_schema_exists', EXISTS (
      SELECT 1 FROM information_schema.schemata s WHERE s.schema_name = 'storage'
    ),
    'buckets_table_exists', EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'storage'
        AND t.table_name = 'buckets'
    ),
    'buckets_columns', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'ordinal_position', c.ordinal_position
          )
          ORDER BY c.ordinal_position, c.column_name
        )
        FROM information_schema.columns c
        WHERE c.table_schema = 'storage'
          AND c.table_name = 'buckets'
      ),
      '[]'::jsonb
    )
  ) AS meta
),

-- Bucket configuration rows (Supabase storage.buckets). Does not touch storage.objects.
-- Target environments are Supabase projects where storage.buckets exists.
storage_buckets AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'public', b.public,
        'file_size_limit', b.file_size_limit,
        'allowed_mime_types', to_jsonb(b.allowed_mime_types),
        'created_at', b.created_at,
        'updated_at', b.updated_at
      )
      ORDER BY b.id::text, b.name
    ),
    '[]'::jsonb
  ) AS data
  FROM storage.buckets b
),

migration_history AS (
  -- Existence only via information_schema so the report parses even when
  -- supabase_migrations was never created (common with SQL-editor applies).
  -- Version row listing would require dynamic SQL (EXECUTE/DO), which this pack forbids.
  SELECT jsonb_build_object(
    'supabase_migrations_schema_exists', EXISTS (
      SELECT 1
      FROM information_schema.schemata s
      WHERE s.schema_name = 'supabase_migrations'
    ),
    'schema_migrations_table_exists', EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'supabase_migrations'
        AND t.table_name = 'schema_migrations'
    ),
    'schema_migrations_columns', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'ordinal_position', c.ordinal_position
          )
          ORDER BY c.ordinal_position, c.column_name
        )
        FROM information_schema.columns c
        WHERE c.table_schema = 'supabase_migrations'
          AND c.table_name = 'schema_migrations'
      ),
      '[]'::jsonb
    )
  ) AS data
)

SELECT jsonb_build_object(
  'report', 'florisyn_live_schema_snapshot',
  'report_version', 1,
  'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
  'schemas', (SELECT data FROM schemas),
  'tables', (SELECT data FROM tables),
  'columns', (SELECT data FROM columns),
  'rls', (SELECT data FROM rls),
  'policies', (SELECT data FROM policies),
  'table_grants', (SELECT data FROM table_grants),
  'functions', (SELECT data FROM functions),
  'function_execute_privileges', (SELECT data FROM function_execute_privileges),
  'triggers', (SELECT data FROM triggers),
  'constraints', (SELECT data FROM constraints),
  'indexes', (SELECT data FROM indexes),
  'storage_bucket_catalog', (SELECT meta FROM storage_bucket_catalog),
  'storage_buckets', (SELECT data FROM storage_buckets),
  'migration_history', (SELECT data FROM migration_history)
) AS florisyn_live_schema_snapshot;

ROLLBACK;
