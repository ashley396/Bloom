/**
 * P0-07A R4 — Live schema snapshot SQL safety suite.
 * No hosted database connection. No credentials required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import {
  DEFAULT_SNAPSHOT_SQL_PATH,
  FORBIDDEN_STATEMENT_TOKENS,
  ALLOWED_FUNCTION_CALLS,
  ALLOWED_RELATIONS,
  validateSchemaSnapshotSql,
  validateSchemaSnapshotFile,
  stripSqlCommentsAndStrings,
  lexSql,
  extractCteNames,
  extractFromJoinRelations,
  analyzeFromJoinRelations,
  allowlistShadowNames
} from "../scripts/validate-schema-snapshot-sql.mjs";

const ROOT = process.cwd();
const SNAPSHOT_SQL = path.join(ROOT, DEFAULT_SNAPSHOT_SQL_PATH);
const VALIDATOR_PATH = path.join(ROOT, "scripts/validate-schema-snapshot-sql.mjs");
const PACKAGE_JSON = path.join(ROOT, "package.json");

/** Exact approved filtered proconfig extraction fragment. */
const APPROVED_PROCONFIG_FRAGMENT = `COALESCE(
      (
        SELECT jsonb_agg(cfg ORDER BY cfg)
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      ),
      '[]'::jsonb
    )`;

function readApprovedSql() {
  return fs.readFileSync(SNAPSHOT_SQL, "utf8");
}

function threeStmt(middle) {
  const body = String(middle).trimEnd();
  const withSemi = /;$/.test(body) ? body : `${body};`;
  return `BEGIN READ ONLY;\n${withSemi}\nROLLBACK;\n`;
}

/** Minimal SQL that satisfies grammar, proconfig, ORDER BY, and CTE rules. */
function validMinimal() {
  return threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'report', 't',
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT florisyn_live_schema_snapshot FROM x CROSS JOIN y ORDER BY 1`);
}

function withForbiddenRelation(relationSql) {
  return threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  CROSS JOIN ${relationSql} bad
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
}

test("approved snapshot SQL file exists and passes validator", () => {
  assert.ok(fs.existsSync(SNAPSHOT_SQL), "snapshot SQL must exist");
  const result = validateSchemaSnapshotFile(SNAPSHOT_SQL);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.statements.length, 3);
});

test("approved SQL declares exact three-statement grammar", () => {
  const result = validateSchemaSnapshotFile(SNAPSHOT_SQL);
  assert.match(result.statements[0], /^BEGIN\s+READ\s+ONLY$/i);
  assert.match(result.statements[1], /^WITH\b/i);
  assert.match(result.statements[1], /\bSELECT\b/i);
  assert.match(result.statements[2], /^ROLLBACK$/i);
});

test("approved SQL covers required metadata sections", () => {
  const sql = readApprovedSql();
  for (const key of [
    "schemas",
    "tables",
    "columns",
    "rls",
    "policies",
    "table_grants",
    "functions",
    "function_execute_privileges",
    "triggers",
    "constraints",
    "indexes",
    "storage_bucket_catalog",
    "storage_buckets",
    "migration_history",
    "specific_name",
    "search_path_config"
  ]) {
    assert.match(sql, new RegExp(key, "i"), `missing ${key}`);
  }
});

test("ALLOWED_RELATIONS exports the exact approved relation set", () => {
  assert.deepEqual([...ALLOWED_RELATIONS], [
    "pg_namespace",
    "information_schema.schemata",
    "information_schema.tables",
    "information_schema.columns",
    "pg_class",
    "pg_policies",
    "information_schema.role_table_grants",
    "pg_proc",
    "pg_language",
    "information_schema.routine_privileges",
    "information_schema.triggers",
    "information_schema.table_constraints",
    "pg_index",
    "storage.buckets"
  ]);
});

test("every relation in approved SQL is allowlisted or a declared CTE", () => {
  const result = validateSchemaSnapshotFile(SNAPSHOT_SQL);
  assert.equal(result.ok, true, result.errors.join("; "));
  const withSelect = result.statements[1];
  const ctes = new Set(extractCteNames(withSelect).map((n) => n.toLowerCase()));
  const allowed = new Set(ALLOWED_RELATIONS.map((r) => r.toLowerCase()));
  const shadow = allowlistShadowNames();
  const usableCtes = new Set([...ctes].filter((c) => !shadow.has(c)));
  const relations = extractFromJoinRelations(result.stripped);
  assert.ok(relations.length > 0, "expected FROM/JOIN relations in approved SQL");
  for (const rel of relations) {
    assert.ok(
      allowed.has(rel) || usableCtes.has(rel),
      `relation ${rel} must be allowlisted or a declared CTE (ctes=${[...ctes].join(",")})`
    );
  }
  // unnest(...) must not be treated as a relation
  assert.ok(!relations.includes("unnest"));
});

test("walker extracts every allowlisted catalog relation used in approved SQL", () => {
  const result = validateSchemaSnapshotFile(SNAPSHOT_SQL);
  assert.equal(result.ok, true, result.errors.join("; "));
  const found = new Set(extractFromJoinRelations(result.stripped));
  for (const rel of ALLOWED_RELATIONS) {
    assert.ok(found.has(rel.toLowerCase()), `expected walker to extract ${rel}`);
  }
});

test("all_config is absent from approved SQL", () => {
  const sql = readApprovedSql();
  assert.doesNotMatch(sql, /\ball_config\b/i);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("validator rejects all_config output", () => {
  const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'all_config', to_jsonb(p.proconfig),
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /all_config|proconfig/i.test(e)));
});

test("no NOW/clock timestamp and no captured_at in approved SQL", () => {
  const sql = readApprovedSql();
  assert.doesNotMatch(sql, /\bcaptured_at\b/i);
  assert.doesNotMatch(sql, /\bNOW\s*\(/i);
  assert.doesNotMatch(sql, /\bCLOCK_TIMESTAMP\s*\(/i);
});

test("transaction_read_only comes from current_setting, not hardcoded true", () => {
  const sql = readApprovedSql();
  assert.match(sql, /current_setting\s*\(\s*'transaction_read_only'\s*\)/i);
  assert.doesNotMatch(sql, /'transaction_read_only'\s*,\s*true\b/i);
  const bad = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', true,
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Hardcoded transaction_read_only|current_setting/i.test(e)));
});

test("function execute privileges include specific_name", () => {
  assert.match(readApprovedSql(), /specific_name/i);
});

test("every classic forbidden write/DDL token is rejected", () => {
  for (const token of FORBIDDEN_STATEMENT_TOKENS) {
    const body =
      token === "SET ROLE" || token.includes(" ")
        ? `${token} x;\nSELECT 1;`
        : `${token} something;`;
    const sql = `BEGIN READ ONLY;\n${body}\nROLLBACK;\n`;
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${token} must fail`);
    assert.ok(
      result.errors.some((e) => e.toUpperCase().includes(token.split(/\s+/)[0].toUpperCase())),
      `${token} expected in errors: ${result.errors.join("; ")}`
    );
  }
});

test("rejects SET TRANSACTION READ WRITE after BEGIN READ ONLY", () => {
  const sql = `BEGIN READ ONLY;\nSET TRANSACTION READ WRITE;\n${validMinimal().replace(/^BEGIN READ ONLY;\n/, "").replace(/\nROLLBACK;\n$/, "")}\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /SET TRANSACTION|exactly 3|Unrecognized/i.test(e)));
});

test("rejects COMMIT", () => {
  const sql = validMinimal().replace(/ROLLBACK;\n$/, "COMMIT;\n");
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /COMMIT|ROLLBACK must be the final/i.test(e)));
});

test("rejects ROLLBACK followed by another statement", () => {
  const sql = `${validMinimal()}\nSELECT 1;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /exactly 3|final|Unrecognized/i.test(e)));
});

test("rejects a second transaction / extra BEGIN", () => {
  const sql = `BEGIN READ ONLY;\nBEGIN READ ONLY;\nWITH x AS (SELECT jsonb_build_object('transaction_read_only', (current_setting('transaction_read_only') = 'on'), 'specific_name', 's') ORDER BY 1) SELECT 1 ORDER BY 1;\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /BEGIN|exactly 3|Additional/i.test(e)));
});

test("rejects extra top-level SELECT statements", () => {
  const sql = validMinimal().replace(
    /\nROLLBACK;\n$/,
    ";\nSELECT 1;\nROLLBACK;\n"
  );
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /exactly 3|Unrecognized/i.test(e)));
});

test("rejects LOCK/NOTIFY/LISTEN", () => {
  for (const cmd of ["LOCK TABLE t", "NOTIFY channel", "LISTEN channel"]) {
    const sql = `BEGIN READ ONLY;\n${cmd};\nROLLBACK;`;
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${cmd} must fail`);
  }
});

test("rejects unknown top-level commands", () => {
  const sql = `BEGIN READ ONLY;\nEXPLAIN SELECT 1;\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unrecognized|exactly 3/i.test(e)));
});

test("rejects unterminated single quote", () => {
  const sql = `BEGIN READ ONLY;\nSELECT 'oops;\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unterminated single-quoted/i.test(e)));
});

test("rejects unterminated dollar quote", () => {
  const sql = `BEGIN READ ONLY;\nSELECT $$oops;\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unterminated dollar quote/i.test(e)));
});

test("rejects unterminated block comment", () => {
  const sql = `BEGIN READ ONLY;\n/* never closed\nSELECT 1;\nROLLBACK;`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unterminated block comment/i.test(e)));
});

test("supports nested block comments when properly closed", () => {
  const sql = `BEGIN READ ONLY;
/* outer /* inner */ still outer */
WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT x.florisyn_live_schema_snapshot FROM x CROSS JOIN y ORDER BY 1;
ROLLBACK;`;
  const lexed = lexSql(sql);
  assert.equal(lexed.ok, true, lexed.errors.join("; "));
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("rejects side-effect / unsafe function calls", () => {
  const cases = [
    ["dblink", "SELECT dblink('a','b')"],
    ["http_get", "SELECT http_get('http://x')"],
    ["lo_import", "SELECT lo_import('/tmp/x')"],
    ["pg_read_file", "SELECT pg_read_file('/etc/passwd')"],
    ["pg_write_file", "SELECT pg_write_file('/tmp/x','y')"],
    ["pg_notify", "SELECT pg_notify('c','p')"],
    ["set_config", "SELECT set_config('a','b',true)"],
    ["now", "SELECT now()"]
  ];
  for (const [name, expr] of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'v', (${expr})
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${name} must fail`);
    assert.ok(
      result.errors.some((e) => e.toLowerCase().includes(name.toLowerCase()) || /allowlist|Prohibited/i.test(e)),
      `${name}: ${result.errors.join("; ")}`
    );
  }
});

test("function-call allowlist is exported and non-empty", () => {
  assert.ok(ALLOWED_FUNCTION_CALLS.includes("current_setting"));
  assert.ok(ALLOWED_FUNCTION_CALLS.includes("jsonb_build_object"));
  assert.ok(ALLOWED_FUNCTION_CALLS.includes("pg_get_indexdef"));
});

test("comments and harmless string contents do not create false positives", () => {
  const sql = `
BEGIN READ ONLY;
-- This comment mentions INSERT UPDATE DELETE CREATE DROP GRANT EXECUTE CALL DO VACUUM COMMIT END LOCK NOTIFY "pg_read_file"
/* Also nested /* inner */ block: MERGE TRUNCATE ALTER REFRESH SET ROLE auth.users storage.objects vault prosrc all_config NOW() "public"."customers" */
WITH x AS (
  SELECT jsonb_build_object(
    'note', 'safe string with INSERT UPDATE DELETE CREATE EXECUTE GRANT vault prosrc all_config NOW() and "quoted"',
    'also', $$dollar INSERT DELETE CREATE EXECUTE COMMIT "pg_catalog"."pg_read_file"$$,
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT florisyn_live_schema_snapshot FROM x CROSS JOIN y ORDER BY 1;
ROLLBACK;
`;
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("missing READ ONLY / wrong begin is rejected", () => {
  const sql = "BEGIN;\nWITH x AS (SELECT jsonb_build_object('transaction_read_only', (current_setting('transaction_read_only') = 'on'), 'specific_name', 's') ORDER BY 1) SELECT 1 ORDER BY 1;\nROLLBACK;\n";
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /BEGIN READ ONLY|READ ONLY/i.test(e)));
});

test("missing ROLLBACK is rejected", () => {
  const sql =
    "BEGIN READ ONLY;\nWITH x AS (SELECT jsonb_build_object('transaction_read_only', (current_setting('transaction_read_only') = 'on'), 'specific_name', 's') ORDER BY 1) SELECT 1 ORDER BY 1;\n";
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /ROLLBACK/i.test(e)));
});

test("sensitive catalog/data references are rejected", () => {
  const cases = [
    ["auth.users", "SELECT id FROM auth.users"],
    ["storage.objects", "SELECT name FROM storage.objects"],
    ["vault", "SELECT 1 FROM vault.secrets"],
    ["prosrc", "SELECT prosrc FROM pg_proc"],
    ["pg_get_functiondef", "SELECT pg_get_functiondef(oid) FROM pg_proc"],
    ["routine_definition", "SELECT routine_definition FROM information_schema.routines"]
  ];
  for (const [id, frag] of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'v', (${frag} LIMIT 0)
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${id} must fail: ${result.errors.join("; ")}`);
  }
});

test("rejects forbidden application/auth/storage/unknown relations", () => {
  const cases = [
    "public.customers",
    "public.orders",
    "public.payments",
    "public.staff",
    "auth.identities",
    "auth.sessions",
    "storage.objects",
    "vault.secrets",
    "private.anything",
    "unknown_schema.anything",
    "mystery_table"
  ];
  for (const rel of cases) {
    const result = validateSchemaSnapshotSql(withForbiddenRelation(rel));
    assert.equal(result.ok, false, `${rel} must fail`);
    assert.ok(
      result.errors.some((e) =>
        /Relation not on allowlist|Forbidden (auth|storage|public)|not a declared CTE/i.test(e)
      ),
      `${rel}: ${result.errors.join("; ")}`
    );
  }
});

test("token walker rejects comma-separated forbidden relations", () => {
  const cases = [
    ["public.customers", "FROM pg_proc p, public.customers c"],
    ["public.orders", "FROM pg_proc p, public.orders o"],
    ["mystery_table", "FROM pg_proc p, mystery_table m"]
  ];
  for (const [label, fromClause] of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  ${fromClause}
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} comma relation must fail`);
    assert.ok(
      result.errors.some((e) => /Relation not on allowlist|Forbidden public|not a declared CTE/i.test(e)),
      `${label}: ${result.errors.join("; ")}`
    );
    const rels = extractFromJoinRelations(result.stripped || stripSqlCommentsAndStrings(sql));
    assert.ok(
      rels.some((r) => r.includes(label.split(".").pop()) || r === label),
      `walker must extract ${label}: got ${rels.join(",")}`
    );
  }
});

test("token walker rejects nested subquery, CTE, LATERAL, and nested-CTE forbidden relations", () => {
  const cases = [
    [
      "comma inside nested subquery",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'v', (SELECT 1 FROM pg_proc p, public.customers c LIMIT 0)
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "forbidden relation inside CTE",
      threeStmt(`WITH bad AS (
  SELECT 1 AS n FROM public.staff s ORDER BY 1
),
x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
)
SELECT * FROM x CROSS JOIN bad ORDER BY 1`)
    ],
    [
      "forbidden relation inside LATERAL subquery",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  CROSS JOIN LATERAL (SELECT 1 FROM auth.identities i LIMIT 0) lat
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "nested CTE reading public.payments",
      threeStmt(`WITH outer_cte AS (
  WITH inner_cte AS (
    SELECT 1 AS n FROM public.payments pay ORDER BY 1
  )
  SELECT n FROM inner_cte ORDER BY 1
),
x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
)
SELECT * FROM x CROSS JOIN outer_cte ORDER BY 1`)
    ]
  ];

  for (const [label, sql] of cases) {
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} must fail`);
    assert.ok(
      result.errors.some((e) =>
        /Relation not on allowlist|Forbidden (auth|public)|not a declared CTE/i.test(e)
      ),
      `${label}: ${result.errors.join("; ")}`
    );
  }
});

test("rejects CTE names that shadow allowlisted catalog relations", () => {
  for (const cteName of ["pg_proc", "storage"]) {
    const sql = threeStmt(`WITH ${cteName} AS (
  SELECT 1 AS n ORDER BY 1
),
x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_namespace n
  ORDER BY 1
)
SELECT * FROM x CROSS JOIN ${cteName} ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `CTE ${cteName} must fail`);
    assert.ok(
      result.errors.some((e) => /CTE name shadows allowlisted catalog relation/i.test(e)),
      `${cteName}: ${result.errors.join("; ")}`
    );
  }
});

test("multiple safe allowlisted relations joined together are accepted", () => {
  const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  CROSS JOIN information_schema.schemata s
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, true, result.errors.join("; "));
  const rels = new Set(result.relations);
  assert.ok(rels.has("pg_proc"));
  assert.ok(rels.has("pg_namespace"));
  assert.ok(rels.has("pg_language"));
  assert.ok(rels.has("information_schema.schemata"));
});

test("R4: WITH ORDINALITY comma bypass extracts and rejects public.customers", () => {
  const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM unnest(ARRAY[1]) WITH ORDINALITY u, public.customers c
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(
    result.relations.includes("public.customers"),
    `must extract public.customers; got ${result.relations.join(",")}`
  );
  assert.ok(
    result.errors.some((e) => /Forbidden public\/application relation: public\.customers/i.test(e)),
    result.errors.join("; ")
  );
  assert.equal((result.parseErrors || []).length, 0, "valid WITH ORDINALITY must not parse-error");
});

test("R4: WITH ORDINALITY alias and column-list forms reject trailing forbidden relations", () => {
  const cases = [
    [
      "WITH ORDINALITY AS u, public.orders",
      `FROM unnest(ARRAY[1]) WITH ORDINALITY AS u, public.orders o`,
      "public.orders"
    ],
    [
      "WITH ORDINALITY u(value, ordinal), public.payments",
      `FROM unnest(ARRAY[1]) WITH ORDINALITY u(value, ordinal), public.payments p`,
      "public.payments"
    ],
    [
      "table alias column list then public.staff",
      `FROM pg_namespace n(nspname), public.staff s`,
      "public.staff"
    ],
    [
      "nested subquery WITH ORDINALITY then auth.identities",
      `FROM (SELECT 1 FROM unnest(ARRAY[1]) WITH ORDINALITY u, auth.identities i) sub`,
      "auth.identities"
    ],
    [
      "LATERAL table function WITH ORDINALITY then storage.objects",
      `FROM LATERAL unnest(ARRAY[1]) WITH ORDINALITY u, storage.objects o`,
      "storage.objects"
    ]
  ];

  for (const [label, fromClause, forbidden] of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  ${fromClause}
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} must fail`);
    assert.ok(
      result.relations.includes(forbidden),
      `${label}: must extract ${forbidden}; got ${result.relations.join(",")}`
    );
    assert.ok(
      result.errors.some((e) =>
        e.toLowerCase().includes(forbidden) ||
        /Forbidden (public|auth|storage)|Relation not on allowlist/i.test(e)
      ),
      `${label}: ${result.errors.join("; ")}`
    );
  }
});

test("R4: unsupported FROM-item suffix fails closed", () => {
  const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p TABLESAMPLE SYSTEM (50)
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(
    (result.parseErrors || []).length > 0 ||
      result.errors.some((e) => /FROM-item parse error|Unsupported FROM-item suffix/i.test(e)),
    `must fail closed on unknown suffix: ${result.errors.join("; ")}`
  );
  const analysis = analyzeFromJoinRelations(result.stripped);
  assert.ok(analysis.parseErrors.length > 0, "analyzeFromJoinRelations must report parseErrors");
});

test("rejects double-quoted executable identifiers", () => {
  const cases = [
    [`"pg_catalog"."pg_read_file"('/etc/passwd')`, "quoted catalog function"],
    [`"pg_read_file"('/etc/passwd')`, "quoted unknown function"],
    [`"public"."customers"`, "quoted relation"],
    [`"mystery_fn"()`, "quoted unknown function call"],
    [`SELECT 1 FROM "pg_class"`, "quoted relation FROM"]
  ];
  for (const [frag, label] of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'v', (${frag})
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} must fail`);
    assert.ok(
      result.errors.some((e) => /Double-quoted identifiers are forbidden/i.test(e)),
      `${label}: ${result.errors.join("; ")}`
    );
  }
});

test("exact proconfig rule rejects unsafe and duplicate extractions", () => {
  const scaffold = (extraSelectExpr, extraFrom = "") =>
    threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    ${extraSelectExpr}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ${extraFrom}
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);

  const cases = [
    [
      "direct SELECT p.proconfig",
      scaffold(`'cfg', (SELECT p.proconfig), 'note', 'search_path=%'`)
    ],
    [
      "jsonb_agg(p.proconfig)",
      scaffold(`'cfg', (SELECT jsonb_agg(p.proconfig)), 'note', 'search_path=%'`)
    ],
    [
      "unsafe dump with fake search_path nearby",
      scaffold(`'cfg', p.proconfig, 'fake', 'search_path=% nearby text'`)
    ],
    [
      "two proconfig references",
      scaffold(
        `'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}, 'again', p.proconfig`
      )
    ],
    [
      "differently named key with full proconfig",
      scaffold(`'config_dump', to_jsonb(p.proconfig), 'note', 'search_path=%'`)
    ],
    [
      "filtered plus second unfiltered",
      scaffold(
        `'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT}, 'dump', (SELECT jsonb_agg(c) FROM unnest(p.proconfig) c)`
      )
    ]
  ];

  for (const [label, sql] of cases) {
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} must fail`);
    assert.ok(
      result.errors.some((e) => /proconfig/i.test(e)),
      `${label}: ${result.errors.join("; ")}`
    );
  }
});

test("structural proconfig rejects WHERE detached from the scalar subquery", () => {
  const unnestOnly = `COALESCE(
      (
        SELECT jsonb_agg(cfg ORDER BY cfg)
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
      ),
      '[]'::jsonb
    )`;

  const cases = [
    [
      "WHERE text in another CTE",
      threeStmt(`WITH decoy AS (
  SELECT 1 AS n WHERE cfg LIKE 'search_path=%' ORDER BY 1
),
x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${unnestOnly}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
)
SELECT * FROM x CROSS JOIN decoy ORDER BY 1`)
    ],
    [
      "fake WHERE in another subquery",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${unnestOnly},
    'decoy', (SELECT 1 WHERE cfg LIKE 'search_path=%')
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "WHERE using a different alias",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', COALESCE(
      (
        SELECT jsonb_agg(cfg ORDER BY cfg)
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE other LIKE 'search_path=%'
      ),
      '[]'::jsonb
    )
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "WHERE using a different pattern",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', COALESCE(
      (
        SELECT jsonb_agg(cfg ORDER BY cfg)
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path%'
      ),
      '[]'::jsonb
    )
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "WHERE outside the proconfig scalar subquery",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${unnestOnly}
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  WHERE cfg LIKE 'search_path=%'
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ],
    [
      "safe extraction plus second proconfig reference",
      threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'extra', p.proconfig
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`)
    ]
  ];

  for (const [label, sql] of cases) {
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${label} must fail`);
    assert.ok(
      result.errors.some((e) => /proconfig/i.test(e)),
      `${label}: ${result.errors.join("; ")}`
    );
  }
});

test("rejects schema-qualified function calls", () => {
  const cases = [
    "public.jsonb_agg(1)",
    "unsafe.jsonb_agg(1)",
    "pg_catalog.pg_read_file('/etc/passwd')",
    "public.current_setting('transaction_read_only')",
    "unknown_schema.coalesce(1, 2)"
  ];
  for (const expr of cases) {
    const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's',
    'search_path_config', ${APPROVED_PROCONFIG_FRAGMENT},
    'v', (${expr})
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
    const result = validateSchemaSnapshotSql(sql);
    assert.equal(result.ok, false, `${expr} must fail`);
    assert.ok(
      result.errors.some((e) =>
        /Schema-qualified function call is forbidden|Prohibited side-effect|allowlist/i.test(e)
      ),
      `${expr}: ${result.errors.join("; ")}`
    );
  }
});

test("package.json exposes focused live-schema-snapshot test command", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  assert.equal(
    pkg.scripts["test:live-schema-snapshot"],
    "node --test tests/florisyn-live-schema-snapshot.test.js"
  );
});

test("focused package command runs this suite", () => {
  if (process.env.FLORISYN_SNAPSHOT_SUITE_NESTED === "1") {
    return;
  }
  const childEnv = { ...process.env, FLORISYN_SNAPSHOT_SUITE_NESTED: "1" };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync("npm", ["run", "test:live-schema-snapshot"], {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /approved snapshot SQL file exists/i);
  assert.match(r.stdout + r.stderr, /(?:#|ℹ) pass /);
});

test("canonical executable migrations have unique timestamp identities", () => {
  const migrationDir = path.join(ROOT, "supabase/migrations");
  const files = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files, [
    "20260804000000_greenfield_baseline.sql",
    "20260804171338_p0_09d_function_acl_hardening.sql",
    "20260804185015_p0_10_atomic_order_create.sql",
    "20260804205339_p0_12_closed_beta_tenant_isolation.sql",
    "20260804223000_p0_13_policy_consolidation.sql",
    "20260804224500_p0_14_onboarding_convergence.sql",
    "20260805154819_p0_19_refund_idempotency.sql",
    "20260808161129_hq_service_role_grants.sql",
    "20260808210000_holiday_weddings_email_v1.sql",
    "20260810130000_florist_network_growth_v1.sql",
    "20260810140000_competitive_parity_v2.sql",
    "20260810150000_florist_network_zero_platform_fee.sql",
    "20260810160000_florist_wire_stripe_settlement.sql",
    "20260810210000_growth_rpc_grants.sql",
    "20260810230000_florist_community_profile_avatar.sql",
    "20260810240000_florist_community_storage_policies.sql",
    "20260815000000_website_media_library.sql",
    "20260816180000_platform_library_photo_manager.sql",
    "20260817160000_shop_website_text_color.sql",
    "20260817180000_florist_wire_ratings.sql",
    "20260817200000_florist_wire_sending_commission.sql",
    "20260817210000_bud_fix_requests.sql",
    "20260818000000_florist_community_share_permissions.sql",
    "20260819120000_marketing_campaigns_v1.sql",
    "20260819140000_marketing_promotions_v1.sql",
    "20260819160000_florist_community_follows_search_notifications.sql",
    "20260819170000_marketplace_floral_attributes.sql",
    "20260819180000_marketplace_wholesale_orders_lifecycle.sql",
    "20260819190000_marketplace_seller_storefront.sql",
    "20260819200000_marketplace_notifications.sql",
    "20260819210000_marketplace_seller_reviews.sql",
    "20260819220000_marketplace_order_refunds_disputes.sql",
    "20260819230000_marketplace_standing_orders.sql",
    "20260819240000_marketplace_promotions_buyer_read.sql",
    "20260819250000_marketplace_rls_performance_cleanup.sql",
    "20260819260000_marketplace_multiple_permissive_policies.sql",
    "20260819270000_marketplace_drop_redundant_index.sql",
    "20260819280000_drop_duplicate_shop_indexes.sql",
    "20260819290000_platform_rls_initplan_cleanup.sql",
    "20260819300000_platform_unindexed_foreign_keys.sql",
    "20260819310000_marketplace_pricing_tiers_buyer_read.sql",
    "20260820000000_marketplace_seller_shipping_fee.sql",
    "20260820020000_ai_operating_system_v1.sql",
    "20260820030000_stripe_terminal_location.sql",
    "20260820040000_wedding_inspiration_photos.sql",
    "20260821000000_order_atomic_cross_shop_fk_guard.sql",
    "20260821030000_signup_metadata_not_discarded.sql",
    "20260821040000_missing_grants_notifications_reviews_standing_orders_photos.sql",
  ]);
  const versions = files.map((name) => name.match(/^(\d{14})_/i)?.[1]);
  assert.ok(versions.every(Boolean), "every executable migration must use a 14-digit timestamp");
  assert.equal(new Set(versions).size, versions.length, "migration versions must be unique");
});

test("validator CLI exits nonzero on violation and zero on approved file", () => {
  const badPath = path.join(os.tmpdir(), `florisyn-schema-snapshot-bad-${process.pid}.sql`);
  fs.writeFileSync(
    badPath,
    "BEGIN READ ONLY;\nINSERT INTO t VALUES (1);\nROLLBACK;\n",
    "utf8"
  );
  try {
    const bad = spawnSync(process.execPath, ["scripts/validate-schema-snapshot-sql.mjs", badPath], {
      cwd: ROOT,
      encoding: "utf8"
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Forbidden statement token: INSERT|exactly 3/i);

    const good = spawnSync(
      process.execPath,
      ["scripts/validate-schema-snapshot-sql.mjs", DEFAULT_SNAPSHOT_SQL_PATH],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.equal(good.status, 0, good.stderr);
  } finally {
    try {
      fs.unlinkSync(badPath);
    } catch {
      /* ignore */
    }
  }
});

test("validator requires no database connection or credentials", () => {
  const validatorSrc = fs.readFileSync(VALIDATOR_PATH, "utf8");
  assert.doesNotMatch(validatorSrc, /from\s+['"]@?supabase/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]pg['"]/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]postgres/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]node:https?['"]/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]https?:/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]node:net['"]/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]net['"]/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]node:tls['"]/i);
  assert.doesNotMatch(validatorSrc, /from\s+['"]tls['"]/i);
  assert.doesNotMatch(
    validatorSrc,
    /require\s*\(\s*['"][^'"]*(supabase|pg|postgres|https?|net|tls)/i
  );
  assert.doesNotMatch(validatorSrc, /process\.env/);

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  assert.equal(
    pkg.scripts["test:live-schema-snapshot"],
    "node --test tests/florisyn-live-schema-snapshot.test.js"
  );

  const credentialKeys = [
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "COMMUNITY_TEST_DATABASE_URL",
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "DATABASE_URL_STAGING",
    "DATABASE_URL_PRODUCTION"
  ];
  const cleanEnv = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || os.homedir(),
    LANG: process.env.LANG || "C.UTF-8"
  };
  for (const key of credentialKeys) {
    assert.equal(cleanEnv[key], undefined);
  }

  const r = spawnSync(
    process.execPath,
    ["scripts/validate-schema-snapshot-sql.mjs", DEFAULT_SNAPSHOT_SQL_PATH],
    { cwd: ROOT, encoding: "utf8", env: cleanEnv }
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /validation passed/i);

  assert.equal(validateSchemaSnapshotSql(readApprovedSql()).ok, true);
  assert.equal(typeof stripSqlCommentsAndStrings(readApprovedSql()), "string");
});

test("rejects unfiltered proconfig dump", () => {
  const sql = threeStmt(`WITH x AS (
  SELECT jsonb_build_object(
    'cfg', (SELECT jsonb_agg(cfg) FROM unnest(p.proconfig) cfg),
    'transaction_read_only', (current_setting('transaction_read_only') = 'on'),
    'specific_name', 's'
  ) AS florisyn_live_schema_snapshot
  FROM pg_proc p
  ORDER BY 1
),
y AS (SELECT 1 AS n ORDER BY 1)
SELECT * FROM x CROSS JOIN y ORDER BY 1`);
  const result = validateSchemaSnapshotSql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /proconfig/i.test(e)));
});
