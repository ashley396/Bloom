/**
 * P0-02 — Platform admin authorization boundary.
 *
 * platformAdmin() is a SERVER authorization boundary, not a browser
 * database-access mechanism. These tests prove:
 *   - bearer token verification happens first and fails closed
 *   - only the verified user.id (never body/query/headers/user_metadata) is used
 *   - the service-role client is created only after authentication succeeds
 *   - platform_admins is queried with the service-role client, never a user JWT
 *   - role gates (support/designer/billing/super_admin) match the documented matrix
 *   - every platformAdmin() call site is accounted for
 *   - every mutation branch has an explicit role gate
 *   - no service-role secret ever appears in public/frontend bundles
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  platformAdmin,
  requireSuperAdmin,
  requireAnyActiveAdmin,
} from "../netlify/functions/_shared/platform-admin.js";

const VERIFIED_USER_ID = "11111111-1111-1111-1111-111111111111";
const ATTACKER_USER_ID = "99999999-9999-9999-9999-999999999999";

function authOk(userId = VERIFIED_USER_ID, calls) {
  return async (event) => {
    if (calls) calls.push({ step: "authenticate", event });
    return { user: { id: userId }, usesServiceRole: false };
  };
}

function authMissingToken(calls) {
  return async () => {
    if (calls) calls.push({ step: "authenticate" });
    const err = new Error("Please sign in");
    err.statusCode = 401;
    throw err;
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

/** Fake service-role client: only ever looked up by the recorded .eq() filter value. */
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

// ---------------------------------------------------------------------------
// 1. No bearer token denied — uses REAL default authenticatedUser (no network I/O
//    required: it checks the Authorization header before creating any client).
// ---------------------------------------------------------------------------
test("no bearer token: real default path denies with 401 before any server client", async () => {
  const event = { headers: {} };
  await assert.rejects(() => platformAdmin(event), (err) => {
    assert.equal(err.statusCode, 401);
    return true;
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid/expired bearer token denied; server client never created.
// ---------------------------------------------------------------------------
test("invalid bearer token denied with 401; server client never created", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [] });
  const deps = {
    authenticate: authInvalidToken(calls),
    createServerClient: serverClientFactory(client, calls),
  };
  await assert.rejects(() => platformAdmin(eventWithBearer(), [], deps), (err) => {
    assert.equal(err.statusCode, 401);
    return true;
  });
  assert.equal(calls.filter((c) => c.step === "createServerClient").length, 0);
});

// ---------------------------------------------------------------------------
// 3. Verified non-admin denied.
// ---------------------------------------------------------------------------
test("verified non-admin (no platform_admins row) denied with 403", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [], calls });
  const deps = { authenticate: authOk(VERIFIED_USER_ID, calls), createServerClient: serverClientFactory(client, calls) };
  await assert.rejects(() => platformAdmin(eventWithBearer(), [], deps), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
  const filtered = calls.find((c) => c.step === "eq");
  assert.equal(filtered.val, VERIFIED_USER_ID);
});

// ---------------------------------------------------------------------------
// 4. Inactive administrator denied.
// ---------------------------------------------------------------------------
test("inactive administrator denied with 403", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: false }],
  });
  const deps = { authenticate: authOk(), createServerClient: serverClientFactory(client) };
  await assert.rejects(() => platformAdmin(eventWithBearer(), [], deps), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});

// ---------------------------------------------------------------------------
// 5-8. Role matrix: support / designer / billing / super_admin.
// ---------------------------------------------------------------------------
function roleMatrixCase(role) {
  return async () => {
    // Baseline (allowedRoles = []): any active admin, including this role, is permitted.
    const anyAdminClient = fakeServerClient({
      rows: [{ user_id: VERIFIED_USER_ID, role, active: true }],
    });
    const anyAdminResult = await platformAdmin(eventWithBearer(), [], {
      authenticate: authOk(),
      createServerClient: serverClientFactory(anyAdminClient),
    });
    assert.equal(anyAdminResult.admin.role, role);
    assert.equal(anyAdminResult.admin.active, true);

    // super_admin-restricted endpoint: non-super_admin roles are denied.
    const restrictedClient = fakeServerClient({
      rows: [{ user_id: VERIFIED_USER_ID, role, active: true }],
    });
    if (role === "super_admin") {
      const ok = await platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(restrictedClient),
      });
      assert.equal(ok.admin.role, "super_admin");
    } else {
      await assert.rejects(
        () =>
          platformAdmin(eventWithBearer(), ["super_admin"], {
            authenticate: authOk(),
            createServerClient: serverClientFactory(restrictedClient),
          }),
        (err) => {
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    }
  };
}

test("support role behavior matches documented matrix", roleMatrixCase("support"));
test("designer role behavior matches documented matrix", roleMatrixCase("designer"));
test("billing role behavior matches documented matrix", roleMatrixCase("billing"));
test("super_admin role behavior matches documented matrix (override on restricted endpoints)", roleMatrixCase("super_admin"));

// ---------------------------------------------------------------------------
// 9. Disallowed role cannot reach the service client (promise rejects before
//    any client object is handed back to caller code).
// ---------------------------------------------------------------------------
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
  assert.equal(reachedDownstream, false, "downstream code must never receive a client on a disallowed role");
});

// ---------------------------------------------------------------------------
// 10. Spoofed body/query admin ID is ignored — only the verified JWT user.id
//     is ever used to look up platform_admins.
// ---------------------------------------------------------------------------
test("spoofed body/query/header admin identity is ignored; only verified user.id is used", async () => {
  const calls = [];
  const client = fakeServerClient({
    rows: [
      { user_id: VERIFIED_USER_ID, role: "support", active: true },
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
  const result = await platformAdmin(spoofedEvent, [], {
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  // If spoofing worked, this would resolve as super_admin (the attacker's row).
  assert.equal(result.admin.user_id, VERIFIED_USER_ID);
  assert.equal(result.admin.role, "support");
  const filtered = calls.find((c) => c.step === "eq");
  assert.equal(filtered.val, VERIFIED_USER_ID);
  assert.notEqual(filtered.val, ATTACKER_USER_ID);
});

// ---------------------------------------------------------------------------
// 12. Server client is created only after JWT verification (ordering proof).
// ---------------------------------------------------------------------------
test("server client is created only after authentication succeeds (ordering)", async () => {
  const calls = [];
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
    calls,
  });
  await platformAdmin(eventWithBearer(), [], {
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  const steps = calls.map((c) => c.step);
  const authIdx = steps.indexOf("authenticate");
  const createIdx = steps.indexOf("createServerClient");
  assert.ok(authIdx >= 0 && createIdx >= 0);
  assert.ok(authIdx < createIdx, "authenticate must run strictly before createServerClient");
});

// ---------------------------------------------------------------------------
// 13. Missing server key fails safely (503), without a raw provider message.
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
      platformAdmin(eventWithBearer(), [], {
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

// ---------------------------------------------------------------------------
// Database/provider failure during the platform_admins lookup is redacted.
// ---------------------------------------------------------------------------
test("platform_admins lookup failure is redacted (no raw provider message)", async () => {
  const rawMessage = "relation \"public.platform_admins\" permission denied for role authenticated at db-host:5432";
  const client = fakeServerClient({ queryError: { code: "42501", message: rawMessage } });
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), [], {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => {
        assert.equal(err.statusCode, 503);
        assert.doesNotMatch(err.message, /permission denied|db-host|platform_admins/);
        return true;
      }
    );
  } finally {
    console.error = orig;
  }
  // The raw cause may be logged server-side only (never returned to the caller).
  assert.ok(logs.some((l) => l.includes("platformAdmin")));
});

test("platform_admins lookup throw is also redacted", async () => {
  const client = fakeServerClient({ queryThrow: new Error("ECONNRESET db-host secret=abc123") });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), [], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(client),
      }),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.doesNotMatch(err.message, /ECONNRESET|secret=/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 14. No service-role key appears in public/frontend files.
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
// 15. Every platformAdmin() call site appears in the audit matrix.
// ---------------------------------------------------------------------------
const EXPECTED_PLATFORM_ADMIN_CALL_SITES = [
  "admin-console.js",
  "admin-command-center.js",
  "marketplace-verification-admin.js",
  "floral-library-admin.js",
];

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
  const found = findPlatformAdminCallSites();
  assert.deepEqual(found, [...EXPECTED_PLATFORM_ADMIN_CALL_SITES].sort());
});

test("audit matrix is documented in FUNCTION-ACCESS-TIERS.md for every call site", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs/production/FUNCTION-ACCESS-TIERS.md"), "utf8");
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const fnName = file.replace(/\.js$/, "");
    assert.match(doc, new RegExp(fnName), `${fnName} must appear in the access-tiers matrix`);
  }
  assert.match(doc, /server authorization boundary/i);
});

// ---------------------------------------------------------------------------
// 16. Mutation actions have explicit role gates (source-level audit).
// ---------------------------------------------------------------------------
test("admin-console.js mutations each have an explicit role gate before mutation", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-console.js"), "utf8");
  const expected = {
    "save-platform-settings": "requireSuperAdmin",
    "mark-alerts-read": "requireAnyActiveAdmin",
    "save-config": "requireSuperAdmin",
    "update-shop": "requireSuperAdmin",
    "update-subscription": "requireSuperAdmin",
  };
  for (const [action, gate] of Object.entries(expected)) {
    const re = new RegExp(`if \\(action === '${action}'\\) \\{\\s*${gate}\\(admin\\);`);
    assert.match(src, re, `admin-console.js action "${action}" must call ${gate}(admin) immediately`);
  }
});

test("admin-command-center.js mutations each have an explicit role gate before mutation", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-command-center.js"), "utf8");
  const expected = {
    "suspend-user": "requireSuperAdmin",
    "reactivate-user": "requireSuperAdmin",
    "password-reset-workflow": "requireAnyActiveAdmin",
    "marketplace-listing": "requireSuperAdmin",
    "support-update": "requireAnyActiveAdmin",
    "create-announcement": "requireSuperAdmin",
    "save-feature-flags": "requireSuperAdmin",
    "lily-query": "requireAnyActiveAdmin",
    "record-ai-request": "requireAnyActiveAdmin",
  };
  for (const [action, gate] of Object.entries(expected)) {
    const re = new RegExp(`if \\(action === "${action}"\\) \\{\\s*${gate}\\(admin\\);`);
    assert.match(src, re, `admin-command-center.js action "${action}" must call ${gate}(admin) immediately`);
  }
});

test("marketplace-verification-admin.js mutation has an explicit super_admin gate", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/marketplace-verification-admin.js"), "utf8");
  assert.match(src, /if \(event\.httpMethod === "POST"\) \{\s*requireSuperAdmin\(admin\);/);
});

test("floral-library-admin.js gates the entire endpoint to super_admin at platformAdmin() entry", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/floral-library-admin.js"), "utf8");
  assert.match(src, /platformAdmin\(event,\s*\["super_admin"\]\)/);
});

// ---------------------------------------------------------------------------
// platformAdmin() itself never uses a user-JWT client for platform_admins.
// ---------------------------------------------------------------------------
test("platform-admin.js queries platform_admins only with the service-role client", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/platform-admin.js"), "utf8");
  assert.match(src, /admin as createServiceRoleClient/);
  assert.match(src, /buildServerClient\(\)/);
  assert.match(src, /serverClient[\s\S]{0,10}\.from\("platform_admins"\)/);
  // Code must never read identity from body/query/headers/user_metadata (comments describing
  // this constraint are fine; only actual property-access patterns would be a violation).
  assert.doesNotMatch(src, /\bbody\.(user_id|admin_id|role)\b/);
  assert.doesNotMatch(src, /queryStringParameters\s*\??\.\s*(user_id|admin_id|role)/);
  assert.doesNotMatch(src, /\.user_metadata\b|\.raw_user_meta_data\b/);
});

// ---------------------------------------------------------------------------
// requireSuperAdmin / requireAnyActiveAdmin sanity (kept alongside legacy suite).
// ---------------------------------------------------------------------------
test("requireAnyActiveAdmin allows any active admin record", () => {
  assert.doesNotThrow(() => requireAnyActiveAdmin({ role: "support", active: true }));
  assert.doesNotThrow(() => requireAnyActiveAdmin({ role: "billing", active: true }));
});

test("requireAnyActiveAdmin rejects an inactive or missing admin record", () => {
  assert.throws(() => requireAnyActiveAdmin({ role: "support", active: false }), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
  assert.throws(() => requireAnyActiveAdmin(null), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});

test("requireSuperAdmin still allows super_admin and blocks others", () => {
  assert.doesNotThrow(() => requireSuperAdmin({ role: "super_admin" }));
  assert.throws(() => requireSuperAdmin({ role: "designer" }), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});
