/**
 * P0-02 / P0-02 R1 — Platform admin authorization boundary.
 *
 * platformAdmin() is a SERVER authorization boundary, not a browser
 * database-access mechanism. These tests prove:
 *   - bearer token verification happens first and fails closed
 *   - only the verified user.id (never body/query/headers/user_metadata) is used
 *   - the service-role client is created only after authentication succeeds
 *   - platform_admins is queried with the service-role client, never a user JWT
 *   - Founding Beta: default and empty allowedRoles fail closed to super_admin only
 *   - support/designer/billing/inactive/unknown/non-admin are denied
 *   - every platformAdmin() call site explicitly requests super_admin
 *   - every mutation branch has requireSuperAdmin immediately before its write
 *   - database/provider errors and thrown exceptions are redacted in responses and logs
 *   - all four handlers use the shared platformAdminErrorResponse boundary
 *   - no service-role secret ever appears in public/frontend bundles
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  logPlatformAdminEvent,
  LOOKUP_FAILURE_MESSAGE,
} from "../netlify/functions/_shared/platform-admin.js";

const VERIFIED_USER_ID = "11111111-1111-1111-1111-111111111111";
const ATTACKER_USER_ID = "99999999-9999-9999-9999-999999999999";

const INJECTED = {
  token: "sk_live_INJECTED_TOKEN_abc123",
  url: "https://db-host.internal:5432/postgres",
  path: "/var/lib/postgresql/data/platform_admins",
  hostname: "db-host.internal",
  providerCode: "42501",
  tableName: "platform_admins",
  rawMessage: 'relation "public.platform_admins" permission denied for role authenticated',
};

function authOk(userId = VERIFIED_USER_ID, calls) {
  return async (event) => {
    if (calls) calls.push({ step: "authenticate", event });
    return { user: { id: userId }, usesServiceRole: false };
  };
}

function authInvalidToken(calls) {
  return async () => {
    if (calls) calls.push({ step: "authenticate" });
    const err = new Error("Your session expired. Please sign in again.");
    err.statusCode = 401;
    throw err;
  };
}

function fakeServerClient({ rows = [], queryError = null, queryThrow = null, calls } = {}) {
  return {
    from(table) {
      let lastEqValue;
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          lastEqValue = val;
          if (calls) calls.push({ step: "eq", table, col, val });
          return builder;
        },
        async maybeSingle() {
          if (calls) calls.push({ step: "maybeSingle", table, filteredBy: lastEqValue });
          if (queryThrow) throw queryThrow;
          if (queryError) return { data: null, error: queryError };
          const row = rows.find((r) => r.user_id === lastEqValue) || null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

function serverClientFactory(client, calls) {
  return () => {
    if (calls) calls.push({ step: "createServerClient" });
    return client;
  };
}

function serverClientFactoryThrows(error, calls) {
  return () => {
    if (calls) calls.push({ step: "createServerClient" });
    throw error;
  };
}

function eventWithBearer(token = "irrelevant-in-fake-authenticate") {
  return { headers: { authorization: `Bearer ${token}` }, queryStringParameters: {}, body: null };
}

function captureConsoleError(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    return { logs, result: fn() };
  } finally {
    console.error = orig;
  }
}

// ---------------------------------------------------------------------------
// Authentication boundary
// ---------------------------------------------------------------------------
test("no bearer token: real default path denies with 401 before any server client", async () => {
  const event = { headers: {} };
  await assert.rejects(() => platformAdmin(event), (err) => {
    assert.equal(err.statusCode, 401);
    return true;
  });
});

test("invalid bearer token denied with 401; server client never created", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [] });
  const deps = {
    authenticate: authInvalidToken(calls),
    createServerClient: serverClientFactory(client, calls),
  };
  await assert.rejects(() => platformAdmin(eventWithBearer(), ["super_admin"], deps), (err) => {
    assert.equal(err.statusCode, 401);
    return true;
  });
  assert.equal(calls.filter((c) => c.step === "createServerClient").length, 0);
});

test("verified non-admin (no platform_admins row) denied with 403", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [], calls });
  const deps = { authenticate: authOk(VERIFIED_USER_ID, calls), createServerClient: serverClientFactory(client, calls) };
  await assert.rejects(() => platformAdmin(eventWithBearer(), ["super_admin"], deps), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
  const filtered = calls.find((c) => c.step === "eq");
  assert.equal(filtered.val, VERIFIED_USER_ID);
});

test("inactive administrator denied with 403", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: false }],
  });
  const deps = { authenticate: authOk(), createServerClient: serverClientFactory(client) };
  await assert.rejects(() => platformAdmin(eventWithBearer(), ["super_admin"], deps), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});

// ---------------------------------------------------------------------------
// P0-02 R1: Founding Beta role lockdown
// ---------------------------------------------------------------------------
const NON_SUPER_ROLES = ["support", "designer", "billing", "unknown_role"];

for (const role of NON_SUPER_ROLES) {
  test(`default platformAdmin() access denies ${role} (fail closed to super_admin)`, async () => {
    const client = fakeServerClient({
      rows: [{ user_id: VERIFIED_USER_ID, role, active: true }],
    });
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), undefined, {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  test(`explicit empty allowedRoles denies ${role} (no any-active-admin fallback)`, async () => {
    const client = fakeServerClient({
      rows: [{ user_id: VERIFIED_USER_ID, role, active: true }],
    });
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), [], {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  test(`explicit super_admin gate denies ${role}`, async () => {
    const client = fakeServerClient({
      rows: [{ user_id: VERIFIED_USER_ID, role, active: true }],
    });
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), ["super_admin"], {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });
}

test("super_admin allowed with default (missing) allowedRoles", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
  });
  const result = await platformAdmin(eventWithBearer(), undefined, {
    authenticate: authOk(),
    createServerClient: serverClientFactory(client),
  });
  assert.equal(result.admin.role, "super_admin");
});

test("super_admin allowed with explicit empty allowedRoles (defaults to super_admin)", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
  });
  const result = await platformAdmin(eventWithBearer(), [], {
    authenticate: authOk(),
    createServerClient: serverClientFactory(client),
  });
  assert.equal(result.admin.role, "super_admin");
});

test("super_admin override still permits access when allowedRoles lists another role", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
  });
  const result = await platformAdmin(eventWithBearer(), ["support"], {
    authenticate: authOk(),
    createServerClient: serverClientFactory(client),
  });
  assert.equal(result.admin.role, "super_admin");
});

test("disallowed role cannot reach the service client returned to callers", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "support", active: true }],
  });
  let reachedDownstream = false;
  try {
    const { client: handedClient } = await platformAdmin(eventWithBearer(), ["super_admin"], {
      authenticate: authOk(),
      createServerClient: serverClientFactory(client),
    });
    reachedDownstream = Boolean(handedClient);
  } catch (err) {
    assert.equal(err.statusCode, 403);
  }
  assert.equal(reachedDownstream, false);
});

// ---------------------------------------------------------------------------
// Identity spoofing ignored
// ---------------------------------------------------------------------------
test("spoofed body/query/header admin identity is ignored; only verified user.id is used", async () => {
  const calls = [];
  const client = fakeServerClient({
    rows: [
      { user_id: VERIFIED_USER_ID, role: "super_admin", active: true },
      { user_id: ATTACKER_USER_ID, role: "super_admin", active: true },
    ],
    calls,
  });
  const spoofedEvent = {
    headers: {
      authorization: "Bearer whatever",
      "x-admin-id": ATTACKER_USER_ID,
      "x-user-id": ATTACKER_USER_ID,
    },
    queryStringParameters: { user_id: ATTACKER_USER_ID, admin_id: ATTACKER_USER_ID, role: "super_admin" },
    body: JSON.stringify({ user_id: ATTACKER_USER_ID, admin_id: ATTACKER_USER_ID, role: "super_admin" }),
  };
  const result = await platformAdmin(spoofedEvent, ["super_admin"], {
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  assert.equal(result.admin.user_id, VERIFIED_USER_ID);
  const filtered = calls.find((c) => c.step === "eq");
  assert.equal(filtered.val, VERIFIED_USER_ID);
  assert.notEqual(filtered.val, ATTACKER_USER_ID);
});

test("server client is created only after authentication succeeds (ordering)", async () => {
  const calls = [];
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
    calls,
  });
  await platformAdmin(eventWithBearer(), ["super_admin"], {
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  const steps = calls.map((c) => c.step);
  const authIdx = steps.indexOf("authenticate");
  const createIdx = steps.indexOf("createServerClient");
  assert.ok(authIdx >= 0 && createIdx >= 0);
  assert.ok(authIdx < createIdx);
});

// ---------------------------------------------------------------------------
// Safe failure / redaction
// ---------------------------------------------------------------------------
test("missing server key fails safely with 503 and a safe message", async () => {
  const founderHint =
    "This needs Florisyn's secure server connection, which is not set up in Netlify yet. You can still view and switch your existing shop locations. If you manage hosting, add the Supabase service key there—or contact Florisyn support.";
  const serverKeyError = Object.assign(new Error(founderHint), {
    statusCode: 503,
    code: "supabase_server_key_missing",
  });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactoryThrows(serverKeyError),
      }),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.doesNotMatch(err.message, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
      return true;
    }
  );
});

test("platform_admins lookup failure is redacted in thrown error (no raw provider message)", async () => {
  const rawMessage = `${INJECTED.rawMessage} at ${INJECTED.hostname}:5432 code=${INJECTED.providerCode}`;
  const client = fakeServerClient({ queryError: { code: INJECTED.providerCode, message: rawMessage } });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(client),
      }),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.equal(err.message, LOOKUP_FAILURE_MESSAGE);
      assert.doesNotMatch(err.message, /permission denied|db-host|platform_admins|42501/);
      return true;
    }
  );
});

test("platform_admins lookup throw is also redacted in thrown error", async () => {
  const client = fakeServerClient({
    queryThrow: new Error(`ECONNRESET ${INJECTED.hostname} secret=${INJECTED.token}`),
  });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(client),
      }),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.doesNotMatch(err.message, /ECONNRESET|secret=|db-host/);
      return true;
    }
  );
});

test("platform_admins lookup failure log uses fixed event and category only (no injected values)", async () => {
  const rawMessage = `${INJECTED.rawMessage} ${INJECTED.url} ${INJECTED.tableName} code=${INJECTED.providerCode}`;
  const client = fakeServerClient({ queryError: { code: INJECTED.providerCode, message: rawMessage } });
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await assert.rejects(() =>
      platformAdmin(
        { headers: { "x-request-id": "req-test-123" } },
        ["super_admin"],
        { authenticate: authOk(), createServerClient: serverClientFactory(client) }
      )
    );
  } finally {
    console.error = orig;
  }
  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_lookup_failed");
  assert.equal(parsed.category, "admin_lookup_db");
  assert.equal(parsed.status, 503);
  assert.equal(parsed.correlationId, "req-test-123");
  const logStr = logs.join(" ");
  for (const val of Object.values(INJECTED)) {
    assert.doesNotMatch(logStr, new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

// ---------------------------------------------------------------------------
// platformAdminErrorResponse boundary
// ---------------------------------------------------------------------------
test("platformAdminErrorResponse redacts 500-level database errors in response body", () => {
  const event = { headers: { "x-request-id": "corr-abc" } };
  const dbError = Object.assign(
    new Error(`${INJECTED.rawMessage} at ${INJECTED.url} table=${INJECTED.tableName}`),
    { statusCode: 500, code: INJECTED.providerCode }
  );
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  let response;
  try {
    response = platformAdminErrorResponse(event, dbError);
  } finally {
    console.error = orig;
  }
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 500);
  assert.equal(body.error, "Unexpected Florisyn error. Try again or contact support.");
  for (const val of Object.values(INJECTED)) {
    assert.doesNotMatch(body.error, new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const logParsed = JSON.parse(logs[0]);
  assert.equal(logParsed.event, "platform_admin_handler_error");
  assert.equal(logParsed.category, "platform_admin_internal");
  assert.equal(logParsed.correlationId, "corr-abc");
  const logStr = logs.join(" ");
  for (const val of Object.values(INJECTED)) {
    assert.doesNotMatch(logStr, new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("platformAdminErrorResponse keeps generic 401/403 messages", () => {
  const r401 = platformAdminErrorResponse({}, Object.assign(new Error("raw auth detail"), { statusCode: 401 }));
  const r403 = platformAdminErrorResponse({}, Object.assign(new Error("raw forbidden detail"), { statusCode: 403 }));
  assert.equal(JSON.parse(r401.body).error, "Please sign in again.");
  assert.equal(JSON.parse(r403.body).error, "You do not have permission to perform this action.");
  assert.doesNotMatch(JSON.parse(r401.body).error, /raw auth/);
  assert.doesNotMatch(JSON.parse(r403.body).error, /raw forbidden/);
});

test("platformAdminErrorResponse allows approved validation messages on 400/404", () => {
  const r400 = platformAdminErrorResponse({}, Object.assign(new Error("shopId is required"), { statusCode: 400 }));
  const r404 = platformAdminErrorResponse({}, Object.assign(new Error("Application not found."), { statusCode: 404 }));
  assert.equal(JSON.parse(r400.body).error, "shopId is required");
  assert.equal(JSON.parse(r404.body).error, "Application not found.");
});

test("platformAdminErrorResponse allowlists Florisyn-owned 503 config errors only", () => {
  const allowlisted = platformAdminErrorResponse(
    {},
    Object.assign(new Error(LOOKUP_FAILURE_MESSAGE), { statusCode: 503 })
  );
  assert.equal(JSON.parse(allowlisted.body).error, LOOKUP_FAILURE_MESSAGE);

  const provider503 = platformAdminErrorResponse(
    {},
    Object.assign(new Error(`${INJECTED.rawMessage} at ${INJECTED.hostname}`), { statusCode: 503 })
  );
  assert.equal(JSON.parse(provider503.body).error, "Florisyn is temporarily unavailable. Please try again.");
  assert.doesNotMatch(JSON.parse(provider503.body).error, /platform_admins|db-host/);
});

test("logPlatformAdminEvent never includes injected sensitive values", () => {
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    logPlatformAdminEvent("platform_admin_test_event", {
      category: "test_category",
      status: 503,
      correlationId: "safe-id-only",
    });
  } finally {
    console.error = orig;
  }
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_test_event");
  assert.equal(parsed.category, "test_category");
  for (const val of Object.values(INJECTED)) {
    assert.doesNotMatch(logs.join(" "), new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

// ---------------------------------------------------------------------------
// No service-role secrets in public/frontend
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [/SUPABASE_SERVICE_ROLE_KEY/, /SUPABASE_SECRET_KEY/, /sk_live_[a-zA-Z0-9]+/, /sb_secret_[a-zA-Z0-9]+/];

function scanFileForSecrets(absPath) {
  const src = fs.readFileSync(absPath, "utf8");
  for (const re of SECRET_PATTERNS) {
    assert.doesNotMatch(src, re, `${absPath} must not contain ${re}`);
  }
}

test("no service-role key or secret pattern in public/*.js and public/*.html", () => {
  const root = path.join(process.cwd(), "public");
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(js|html)$/.test(entry.name)) continue;
    scanFileForSecrets(path.join(root, entry.name));
  }
});

test("no service-role key or secret pattern in frontend/src", () => {
  const root = path.join(process.cwd(), "frontend/src");
  if (!fs.existsSync(root)) return;
  const stack = [root];
  const files = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
    }
  }
  assert.ok(files.length > 0, "expected frontend/src files to scan");
  for (const f of files) scanFileForSecrets(f);
});

// ---------------------------------------------------------------------------
// Call-site inventory
// ---------------------------------------------------------------------------
const EXPECTED_PLATFORM_ADMIN_CALL_SITES = [
  "admin-console.js",
  "admin-command-center.js",
  "marketplace-verification-admin.js",
  "floral-library-admin.js",
];

const PLATFORM_ADMIN_HANDLERS = EXPECTED_PLATFORM_ADMIN_CALL_SITES;

function findPlatformAdminCallSites() {
  const dir = path.join(process.cwd(), "netlify/functions");
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
    if (/\bplatformAdmin\(/.test(src)) found.push(entry.name);
  }
  return found.sort();
}

test("every platformAdmin() call site is accounted for in the audit matrix", () => {
  assert.deepEqual(findPlatformAdminCallSites(), [...EXPECTED_PLATFORM_ADMIN_CALL_SITES].sort());
});

test("every current platform-admin endpoint explicitly requests super_admin", () => {
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.match(
      src,
      /platformAdmin\(event,\s*\["super_admin"\]\)/,
      `${file} must call platformAdmin(event, ["super_admin"]) explicitly`
    );
  }
});

test("all four handlers use the shared platformAdminErrorResponse boundary", () => {
  for (const file of PLATFORM_ADMIN_HANDLERS) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.match(src, /platformAdminErrorResponse\(event,\s*error\)/, `${file} must use platformAdminErrorResponse`);
    assert.doesNotMatch(src, /\bfail\(error\)/, `${file} must not use fail(error)`);
  }
});

test("audit matrix is documented in FUNCTION-ACCESS-TIERS.md for every call site", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs/production/FUNCTION-ACCESS-TIERS.md"), "utf8");
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const fnName = file.replace(/\.js$/, "");
    assert.match(doc, new RegExp(fnName), `${fnName} must appear in the access-tiers matrix`);
  }
  assert.match(doc, /`super_admin`\s+only/i);
  assert.match(doc, /server authorization boundary/i);
});

// ---------------------------------------------------------------------------
// Mutation gates — every write requires requireSuperAdmin immediately before
// ---------------------------------------------------------------------------
test("admin-console.js mutations each have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-console.js"), "utf8");
  const actions = [
    "save-platform-settings",
    "mark-alerts-read",
    "save-config",
    "update-shop",
    "update-subscription",
  ];
  for (const action of actions) {
    const re = new RegExp(`if \\(action === '${action}'\\) \\{\\s*requireSuperAdmin\\(admin\\);`);
    assert.match(src, re, `admin-console.js action "${action}" must call requireSuperAdmin(admin) immediately`);
  }
  assert.doesNotMatch(src, /requireAnyActiveAdmin/);
});

test("admin-command-center.js mutations each have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-command-center.js"), "utf8");
  const actions = [
    "suspend-user",
    "reactivate-user",
    "password-reset-workflow",
    "marketplace-listing",
    "support-update",
    "create-announcement",
    "save-feature-flags",
    "lily-query",
    "record-ai-request",
  ];
  for (const action of actions) {
    const re = new RegExp(`if \\(action === "${action}"\\) \\{\\s*requireSuperAdmin\\(admin\\);`);
    assert.match(src, re, `admin-command-center.js action "${action}" must call requireSuperAdmin(admin) immediately`);
  }
  assert.doesNotMatch(src, /requireAnyActiveAdmin/);
});

test("marketplace-verification-admin.js mutation has requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/marketplace-verification-admin.js"), "utf8");
  assert.match(src, /if \(event\.httpMethod === "POST"\) \{\s*requireSuperAdmin\(admin\);/);
});

test("floral-library-admin.js mutation actions have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/floral-library-admin.js"), "utf8");
  assert.match(
    src,
    /if \(action === "dry_run" \|\| action === "import_validate"\) \{\s*requireSuperAdmin\(admin\);/
  );
  for (const action of ["approve_batch", "duplicate_review"]) {
    const re = new RegExp(`if \\(action === "${action}"\\) \\{\\s*requireSuperAdmin\\(admin\\);`);
    assert.match(src, re, `floral-library-admin.js action "${action}" must call requireSuperAdmin(admin) immediately`);
  }
});

test("platform-admin.js queries platform_admins only with the service-role client", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/platform-admin.js"), "utf8");
  assert.match(src, /admin as createServiceRoleClient/);
  assert.match(src, /buildServerClient\(\)/);
  assert.match(src, /serverClient[\s\S]{0,10}\.from\("platform_admins"\)/);
  assert.doesNotMatch(src, /\bbody\.(user_id|admin_id|role)\b/);
  assert.doesNotMatch(src, /queryStringParameters\s*\??\.\s*(user_id|admin_id|role)/);
  assert.doesNotMatch(src, /\.user_metadata\b|\.raw_user_meta_data\b/);
  assert.doesNotMatch(src, /requireAnyActiveAdmin/);
});

test("requireSuperAdmin allows super_admin and blocks others", () => {
  assert.doesNotThrow(() => requireSuperAdmin({ role: "super_admin" }));
  assert.throws(() => requireSuperAdmin({ role: "designer" }), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});
