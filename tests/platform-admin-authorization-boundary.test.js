/**
 * P0-02 / P0-02 R1 / P0-02 R2 / P0-02 R3 / P0-02 R4 — Platform admin authorization boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  getPlatformAdminRequestId,
  parsePlatformAdminJsonBody,
  PLATFORM_ADMIN_PUBLIC_ERRORS,
  LOOKUP_FAILURE_MESSAGE,
} from "../netlify/functions/_shared/platform-admin.js";
import {
  handler as marketplaceVerificationAdminHandler,
  createMarketplaceVerificationAdminHandler,
} from "../netlify/functions/marketplace-verification-admin.js";
import {
  handler as adminConsoleHandler,
  createAdminConsoleHandler,
} from "../netlify/functions/admin-console.js";
import {
  handler as adminCommandCenterHandler,
  createAdminCommandCenterHandler,
} from "../netlify/functions/admin-command-center.js";
import {
  handler as floralLibraryAdminHandler,
  createFloralLibraryAdminHandler,
} from "../netlify/functions/floral-library-admin.js";
import {
  handler as adminPhotoManagerHandler,
  createAdminPhotoManagerHandler,
} from "../netlify/functions/admin-photo-manager.js";
import { TABLE as VERIFICATION_TABLE } from "../netlify/functions/_shared/marketplace-verification.js";

const VERIFIED_USER_ID = "11111111-1111-1111-1111-111111111111";
const ATTACKER_USER_ID = "99999999-9999-9999-9999-999999999999";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INJECTED = {
  token: "sk_live_INJECTED_TOKEN_abc123",
  url: "https://db-host.internal:5432/postgres",
  path: "/var/lib/postgresql/data/platform_admins",
  hostname: "db-host.internal",
  providerCode: "42501",
  tableName: "platform_admins",
  rawMessage: 'relation "public.platform_admins" permission denied for role authenticated',
  requestId: "INJECTED-REQ-ID-FROM-HEADER",
  correlationId: "INJECTED-CORR-ID-FROM-HEADER",
  eventName: "INJECTED_EVENT_NAME",
  category: "INJECTED_CATEGORY",
  stack: "Error: secret\\n    at /var/secret/path.js:99:1",
};

function assertNoInjectionIn(text) {
  const str = String(text);
  for (const val of Object.values(INJECTED)) {
    assert.doesNotMatch(str, new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

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

function serverClientFactoryThrows(_error, calls) {
  return () => {
    if (calls) calls.push({ step: "createServerClient" });
    throw new Error("SUPABASE_SERVICE_ROLE_KEY leak attempt");
  };
}

function eventWithBearer(token = "irrelevant-in-fake-authenticate") {
  return { headers: { authorization: `Bearer ${token}` }, queryStringParameters: {}, body: null };
}

function eventWithInjectedHeaders() {
  return {
    headers: {
      authorization: "Bearer test",
      "x-request-id": INJECTED.requestId,
      "X-Request-Id": INJECTED.requestId,
      "x-correlation-id": INJECTED.correlationId,
      "X-Correlation-Id": INJECTED.correlationId,
    },
    queryStringParameters: { request_id: INJECTED.requestId },
    body: JSON.stringify({ request_id: INJECTED.requestId }),
  };
}

function captureConsoleError(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs;
}

// ---------------------------------------------------------------------------
// Authentication boundary
// ---------------------------------------------------------------------------
test("no bearer token: real default path denies with 401 before any server client", async () => {
  await assert.rejects(() => platformAdmin({ headers: {} }), (err) => {
    assert.equal(err.statusCode, 401);
    assert.equal(err.florisynCode, "unauthorized");
    return true;
  });
});

test("invalid bearer token denied with 401; server client never created", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [] });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authInvalidToken(calls),
        createServerClient: serverClientFactory(client, calls),
      }),
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.equal(err.florisynCode, "unauthorized");
      return true;
    }
  );
  assert.equal(calls.filter((c) => c.step === "createServerClient").length, 0);
});

test("verified non-admin denied with 403", async () => {
  const calls = [];
  const client = fakeServerClient({ rows: [], calls });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(VERIFIED_USER_ID, calls),
        createServerClient: serverClientFactory(client, calls),
      }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.florisynCode, "forbidden");
      return true;
    }
  );
});

test("inactive administrator denied with 403", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: false }],
  });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(client),
      }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.florisynCode, "forbidden");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// P0-02 R1: Founding Beta role lockdown
// ---------------------------------------------------------------------------
const NON_SUPER_ROLES = ["support", "designer", "billing", "unknown_role"];

for (const role of NON_SUPER_ROLES) {
  test(`default platformAdmin() access denies ${role}`, async () => {
    const client = fakeServerClient({ rows: [{ user_id: VERIFIED_USER_ID, role, active: true }] });
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), undefined, {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => err.statusCode === 403 && err.florisynCode === "forbidden"
    );
  });

  test(`explicit empty allowedRoles denies ${role}`, async () => {
    const client = fakeServerClient({ rows: [{ user_id: VERIFIED_USER_ID, role, active: true }] });
    await assert.rejects(
      () =>
        platformAdmin(eventWithBearer(), [], {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => err.statusCode === 403 && err.florisynCode === "forbidden"
    );
  });
}

test("super_admin allowed with default and empty allowedRoles", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
  });
  const deps = { authenticate: authOk(), createServerClient: serverClientFactory(client) };
  const r1 = await platformAdmin(eventWithBearer(), undefined, deps);
  const r2 = await platformAdmin(eventWithBearer(), [], deps);
  assert.equal(r1.admin.role, "super_admin");
  assert.equal(r2.admin.role, "super_admin");
});

test("super_admin override permits access when allowedRoles lists another role", async () => {
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

test("spoofed body/query/header admin identity is ignored", async () => {
  const calls = [];
  const client = fakeServerClient({
    rows: [
      { user_id: VERIFIED_USER_ID, role: "super_admin", active: true },
      { user_id: ATTACKER_USER_ID, role: "super_admin", active: true },
    ],
    calls,
  });
  const spoofedEvent = {
    headers: { authorization: "Bearer whatever", "x-admin-id": ATTACKER_USER_ID },
    queryStringParameters: { user_id: ATTACKER_USER_ID, admin_id: ATTACKER_USER_ID },
    body: JSON.stringify({ user_id: ATTACKER_USER_ID }),
  };
  const result = await platformAdmin(spoofedEvent, ["super_admin"], {
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  assert.equal(result.admin.user_id, VERIFIED_USER_ID);
  assert.equal(calls.find((c) => c.step === "eq").val, VERIFIED_USER_ID);
});

test("server client is created only after authentication succeeds", async () => {
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
  assert.ok(steps.indexOf("authenticate") < steps.indexOf("createServerClient"));
});

// ---------------------------------------------------------------------------
// P0-02 R2: server-owned request ID
// ---------------------------------------------------------------------------
test("getPlatformAdminRequestId generates a UUID and ignores injected headers", () => {
  const event = eventWithInjectedHeaders();
  const id = getPlatformAdminRequestId(event);
  assert.match(id, UUID_RE);
  assert.notEqual(id, INJECTED.requestId);
  assert.notEqual(id, INJECTED.correlationId);
});

test("same event object receives the same server-generated request ID", () => {
  const event = eventWithInjectedHeaders();
  const id1 = getPlatformAdminRequestId(event);
  const id2 = getPlatformAdminRequestId(event);
  assert.equal(id1, id2);
  assert.match(id1, UUID_RE);
});

test("injected x-request-id and x-correlation-id never appear in lookup failure logs", async () => {
  const client = fakeServerClient({
    queryError: { code: INJECTED.providerCode, message: INJECTED.rawMessage },
  });
  const event = eventWithInjectedHeaders();
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await assert.rejects(
      () =>
        platformAdmin(event, ["super_admin"], {
          authenticate: authOk(),
          createServerClient: serverClientFactory(client),
        }),
      (err) => err.florisynCode === "admin_lookup_unavailable"
    );
  } finally {
    console.error = orig;
  }
  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.match(parsed.requestId, UUID_RE);
  assert.notEqual(parsed.requestId, INJECTED.requestId);
  assertNoInjectionIn(logs.join(" "));
});

// ---------------------------------------------------------------------------
// P0-02 R2: fixed public error catalog
// ---------------------------------------------------------------------------
test("platformAdminError creates Florisyn-owned errors with florisynCode", () => {
  const err = platformAdminError("missing_shop_id");
  assert.equal(err.florisynCode, "missing_shop_id");
  assert.equal(err.statusCode, 400);
  assert.equal(err.message, PLATFORM_ADMIN_PUBLIC_ERRORS.missing_shop_id.message);
});

test("platformAdminErrorResponse ignores raw statusCode/message without Florisyn brand", () => {
  const event = eventWithInjectedHeaders();
  const logs = captureConsoleError(() => {
    const r401 = platformAdminErrorResponse(
      event,
      Object.assign(new Error(`raw auth ${INJECTED.rawMessage}`), { statusCode: 401 })
    );
    const r404 = platformAdminErrorResponse(
      event,
      Object.assign(new Error(`Application not found at ${INJECTED.url}`), { statusCode: 404 })
    );
    assert.equal(r401.statusCode, 500);
    assert.equal(JSON.parse(r401.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assert.equal(r404.statusCode, 500);
    assert.equal(JSON.parse(r404.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assertNoInjectionIn(r401.body);
    assertNoInjectionIn(r404.body);
  });
  assertNoInjectionIn(logs.join(" "));
});

test("platformAdminErrorResponse returns catalog wording for Florisyn-branded errors", () => {
  for (const code of [
    "unauthorized",
    "forbidden",
    "invalid_request",
    "missing_shop_id",
    "not_found",
    "admin_lookup_unavailable",
    "server_key_missing",
    "verification_schema_unavailable",
    "feature_flag_schema_unavailable",
  ]) {
    const response = platformAdminErrorResponse({}, platformAdminError(code));
    const entry = PLATFORM_ADMIN_PUBLIC_ERRORS[code];
    assert.equal(response.statusCode, entry.status, code);
    assert.equal(JSON.parse(response.body).error, entry.message, code);
  }
});

test("platformAdminErrorResponse maps unknown errors to unexpected 500", () => {
  const dbError = Object.assign(
    new Error(`${INJECTED.rawMessage} at ${INJECTED.url} table=${INJECTED.tableName}`),
    {
      statusCode: 500,
      code: INJECTED.providerCode,
      details: INJECTED.path,
      hint: INJECTED.hostname,
      stack: INJECTED.stack,
    }
  );
  const logs = captureConsoleError(() => {
    const response = platformAdminErrorResponse(eventWithInjectedHeaders(), dbError);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assertNoInjectionIn(response.body);
  });
  assertNoInjectionIn(logs.join(" "));
});

test("missing server key maps to server_key_missing Florisyn code", async () => {
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactoryThrows(new Error("key missing")),
      }),
    (err) => err.florisynCode === "server_key_missing" && err.statusCode === 503
  );
});

test("platform_admins lookup failure uses admin_lookup_unavailable code", async () => {
  const client = fakeServerClient({
    queryError: { code: INJECTED.providerCode, message: INJECTED.rawMessage },
  });
  await assert.rejects(
    () =>
      platformAdmin(eventWithBearer(), ["super_admin"], {
        authenticate: authOk(),
        createServerClient: serverClientFactory(client),
      }),
    (err) => {
      assert.equal(err.florisynCode, "admin_lookup_unavailable");
      assert.equal(err.message, LOOKUP_FAILURE_MESSAGE);
      assertNoInjectionIn(err.message);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// P0-02 R2: enforced log allowlist (via public APIs)
// ---------------------------------------------------------------------------
test("handler error log uses allowlisted event/category/status and server requestId only", () => {
  const event = eventWithInjectedHeaders();
  const logs = captureConsoleError(() => {
    platformAdminErrorResponse(event, platformAdminError("forbidden"));
  });
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_handler_error");
  assert.equal(parsed.category, "platform_admin_forbidden");
  assert.equal(parsed.status, 403);
  assert.match(parsed.requestId, UUID_RE);
  assertNoInjectionIn(JSON.stringify(parsed));
});

test("unknown errors normalize to unexpected 500 in response and allowlisted internal log status", () => {
  const err = Object.assign(new Error(INJECTED.rawMessage), {
    statusCode: 418,
    code: INJECTED.providerCode,
    details: INJECTED.path,
    hint: INJECTED.hostname,
    stack: INJECTED.stack,
  });
  const logs = captureConsoleError(() => {
    const response = platformAdminErrorResponse(eventWithInjectedHeaders(), err);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assertNoInjectionIn(response.body);
  });
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_handler_error");
  assert.equal(parsed.status, 500);
  assert.equal(parsed.category, "platform_admin_internal");
  assertNoInjectionIn(JSON.stringify(parsed));
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
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|html)$/.test(entry.name)) continue;
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
  for (const f of files) scanFileForSecrets(f);
});

// ---------------------------------------------------------------------------
// Call-site inventory and mutation gates
// ---------------------------------------------------------------------------
const EXPECTED_PLATFORM_ADMIN_CALL_SITES = [
  "admin-console.js",
  "admin-command-center.js",
  "admin-photo-manager.js",
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

test("every platformAdmin() call site is accounted for", () => {
  assert.deepEqual(findPlatformAdminCallSites(), [...EXPECTED_PLATFORM_ADMIN_CALL_SITES].sort());
});

test("every endpoint explicitly requests super_admin", () => {
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.match(src, /platformAdmin\(event,\s*\["super_admin"\](?:,\s*deps)?\)/);
  }
});

test("all four handlers use platformAdminErrorResponse", () => {
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.match(src, /platformAdminErrorResponse\(event,\s*error\)/);
    assert.doesNotMatch(src, /\bfail\(error\)/);
  }
});

test("all four handlers use parsePlatformAdminJsonBody for request bodies", () => {
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.match(src, /parsePlatformAdminJsonBody\(event\)/);
    assert.doesNotMatch(src, /JSON\.parse\(event\.body\)/);
    assert.doesNotMatch(src, /\bbodyOf\(event\)/);
  }
});

test("audit matrix documented in FUNCTION-ACCESS-TIERS.md", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs/production/FUNCTION-ACCESS-TIERS.md"), "utf8");
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    assert.match(doc, new RegExp(file.replace(/\.js$/, "")));
  }
  assert.match(doc, /`super_admin`\s+only/i);
});

test("admin-console.js mutations each have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-console.js"), "utf8");
  for (const action of ["save-platform-settings", "mark-alerts-read", "save-config", "update-shop", "update-subscription"]) {
    assert.match(src, new RegExp(`if \\(action === '${action}'\\) \\{\\s*requireSuperAdmin\\(admin\\);`));
  }
});

test("admin-command-center.js mutations each have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-command-center.js"), "utf8");
  for (const action of [
    "suspend-user", "reactivate-user", "password-reset-workflow", "marketplace-listing",
    "support-update", "create-announcement", "save-feature-flags", "lily-query", "record-ai-request",
  ]) {
    assert.match(src, new RegExp(`if \\(action === "${action}"\\) \\{\\s*requireSuperAdmin\\(admin\\);`));
  }
});

test("marketplace-verification-admin.js POST has requireSuperAdmin before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/marketplace-verification-admin.js"), "utf8");
  assert.match(src, /if \(event\.httpMethod === "POST"\) \{\s*requireSuperAdmin\(admin\);/);
});

test("floral-library-admin.js mutation actions have requireSuperAdmin before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/floral-library-admin.js"), "utf8");
  assert.match(src, /if \(action === "dry_run" \|\| action === "import_validate"\) \{\s*requireSuperAdmin\(admin\);/);
  for (const action of ["approve_batch", "duplicate_review"]) {
    assert.match(src, new RegExp(`if \\(action === "${action}"\\) \\{\\s*requireSuperAdmin\\(admin\\);`));
  }
});

test("admin-photo-manager.js mutations each have requireSuperAdmin immediately before write", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/admin-photo-manager.js"), "utf8");
  for (const action of ["upload", "update", "delete"]) {
    assert.match(
      src,
      new RegExp(`if \\(action === "${action}" && event\\.httpMethod === "POST"\\) \\{\\s*requireSuperAdmin\\(admin\\);`)
    );
  }
  // public_list is intentionally unauthenticated — read-only, mirrors
  // content florists already see in the static Floral Library.
  assert.match(src, /action === "public_list" && event\.httpMethod === "GET"/);
});

test("platform-admin.js never trusts browser-provided identity or request IDs", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/platform-admin.js"), "utf8");
  assert.doesNotMatch(src, /headers\s*\?\?\.\s*["'`]x-request/i);
  assert.doesNotMatch(src, /headers\s*\?\?\.\s*["'`]x-correlation/i);
  assert.doesNotMatch(src, /\bbody\.(user_id|admin_id|role)\b/);
  assert.doesNotMatch(src, /requireAnyActiveAdmin/);
  assert.match(src, /randomUUID/);
  assert.match(src, /florisynCode/);
});

test("requireSuperAdmin allows super_admin and blocks others with forbidden code", () => {
  assert.doesNotThrow(() => requireSuperAdmin({ role: "super_admin" }));
  assert.throws(() => requireSuperAdmin({ role: "designer" }), (err) => {
    assert.equal(err.florisynCode, "forbidden");
    return true;
  });
});

// ---------------------------------------------------------------------------
// P0-02 R3: Florisyn brand, deep catalog freeze, JSON parser, handler resolve
// ---------------------------------------------------------------------------

test("platformAdminError('forbidden') emits fixed 403 catalog response", () => {
  const response = platformAdminErrorResponse({}, platformAdminError("forbidden"));
  assert.equal(response.statusCode, 403);
  assert.equal(
    JSON.parse(response.body).error,
    PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message
  );
});

test("plain object with florisynCode forbidden becomes generic 500", () => {
  const forged = {
    florisynCode: "forbidden",
    statusCode: 403,
    message: PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message,
  };
  const logs = captureConsoleError(() => {
    const response = platformAdminErrorResponse(eventWithInjectedHeaders(), forged);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assertNoInjectionIn(response.body);
  });
  assertNoInjectionIn(logs.join(" "));
});

test("provider Error with forged florisynCode server_key_missing becomes generic 500", () => {
  const providerErr = Object.assign(
    new Error(`${INJECTED.rawMessage} ${INJECTED.token} ${INJECTED.url}`),
    {
      florisynCode: "server_key_missing",
      statusCode: 503,
      code: INJECTED.providerCode,
      details: INJECTED.path,
      hint: INJECTED.hostname,
      stack: INJECTED.stack,
    }
  );
  const logs = captureConsoleError(() => {
    const response = platformAdminErrorResponse(eventWithInjectedHeaders(), providerErr);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
    assertNoInjectionIn(response.body);
  });
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_handler_error");
  assert.equal(parsed.status, 500);
  assert.equal(parsed.category, "platform_admin_internal");
  assert.match(parsed.requestId, UUID_RE);
  assertNoInjectionIn(logs.join(" "));
});

test("private Florisyn error brand is not exported from platform-admin module", async () => {
  const mod = await import("../netlify/functions/_shared/platform-admin.js");
  for (const key of Object.keys(mod)) {
    assert.doesNotMatch(key, /brand|symbol|WeakSet|FLORISYN_PLATFORM/i);
  }
  const err = platformAdminError("forbidden");
  assert.equal(Object.getOwnPropertySymbols(err).length, 0);
});

test("public error catalog is deeply frozen", () => {
  assert.equal(Object.isFrozen(PLATFORM_ADMIN_PUBLIC_ERRORS), true);
  assert.equal(Object.isFrozen(PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden), true);
  assert.equal(Object.isFrozen(PLATFORM_ADMIN_PUBLIC_ERRORS.verification_schema_unavailable), true);
  assert.equal(Object.isFrozen(PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected), true);

  const originalForbidden = PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message;
  const originalStatus = PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.status;
  const originalVerification = PLATFORM_ADMIN_PUBLIC_ERRORS.verification_schema_unavailable.message;

  assert.throws(() => {
    PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message = "HACKED FORBIDDEN";
  }, TypeError);
  assert.throws(() => {
    PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.status = 200;
  }, TypeError);
  assert.throws(() => {
    PLATFORM_ADMIN_PUBLIC_ERRORS.verification_schema_unavailable.message = "HACKED";
  }, TypeError);

  assert.equal(PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message, originalForbidden);
  assert.equal(PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.status, originalStatus);
  assert.equal(
    PLATFORM_ADMIN_PUBLIC_ERRORS.verification_schema_unavailable.message,
    originalVerification
  );

  const response = platformAdminErrorResponse({}, platformAdminError("forbidden"));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, originalForbidden);
});

test("parsePlatformAdminJsonBody matrix: empty, valid, malformed, non-object", () => {
  assert.deepEqual(parsePlatformAdminJsonBody({ body: null }), {});
  assert.deepEqual(parsePlatformAdminJsonBody({ body: undefined }), {});
  assert.deepEqual(parsePlatformAdminJsonBody({ body: "" }), {});
  assert.deepEqual(parsePlatformAdminJsonBody({}), {});
  assert.deepEqual(parsePlatformAdminJsonBody({ body: '{"action":"overview"}' }), {
    action: "overview",
  });

  for (const body of [
    "{not-json",
    "[]",
    '"string"',
    "42",
    "true",
    "null",
    JSON.stringify(["action"]),
  ]) {
    assert.throws(
      () => parsePlatformAdminJsonBody({ body }),
      (err) => err.florisynCode === "invalid_request" && err.statusCode === 400
    );
  }
});

test("authenticated admin-console handler returns fixed 400 for malformed JSON", async () => {
  const client = fakeServerClient({
    rows: [{ user_id: VERIFIED_USER_ID, role: "super_admin", active: true }],
  });
  const event = {
    httpMethod: "POST",
    headers: {
      authorization: "Bearer test",
      "x-request-id": INJECTED.requestId,
      "x-correlation-id": INJECTED.correlationId,
    },
    queryStringParameters: {},
    body: `{"action":"save-config", "leak":"${INJECTED.token}",`,
  };
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  const testHandler = createAdminConsoleHandler({
    authenticate: authOk(),
    createServerClient: serverClientFactory(client),
  });
  let response;
  try {
    response = await testHandler(event);
  } finally {
    console.error = orig;
  }
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid request." });
  assertNoInjectionIn(response.body);
  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_handler_error");
  assert.equal(parsed.category, "platform_admin_validation");
  assert.equal(parsed.status, 400);
  assert.match(parsed.requestId, UUID_RE);
  assert.notEqual(parsed.requestId, INJECTED.requestId);
  assertNoInjectionIn(logs.join(" "));
});

function marketplaceVerificationClient({ adminRow, verificationError, calls }) {
  return {
    from(table) {
      if (table === "platform_admins") {
        let lastEqValue;
        const builder = {
          select() {
            return builder;
          },
          eq(col, val) {
            lastEqValue = val;
            if (calls) calls.push({ step: "platform_admins_eq", col, val });
            return builder;
          },
          async maybeSingle() {
            if (calls) calls.push({ step: "platform_admins_lookup", filteredBy: lastEqValue });
            if (adminRow && adminRow.user_id === lastEqValue) {
              return { data: adminRow, error: null };
            }
            return { data: null, error: null };
          },
        };
        return builder;
      }

      if (table === VERIFICATION_TABLE) {
        const builder = {
          select() {
            if (calls) calls.push({ step: "verification_select", table });
            return builder;
          },
          order() {
            return builder;
          },
          eq() {
            return builder;
          },
          then(resolve, reject) {
            if (calls) calls.push({ step: "verification_query_settled", table });
            return Promise.resolve({ data: null, error: verificationError }).then(resolve, reject);
          },
        };
        return builder;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("marketplace-verification-admin missing-table path resolves with fixed 503", async () => {
  const calls = [];
  const providerMessage =
    `relation "public.${VERIFICATION_TABLE}" does not exist at ${INJECTED.url} token=${INJECTED.token} path=${INJECTED.path}`;
  const verificationError = Object.assign(new Error(providerMessage), {
    code: "42P01",
    details: INJECTED.path,
    hint: INJECTED.hostname,
    stack: INJECTED.stack,
  });
  const client = marketplaceVerificationClient({
    adminRow: {
      user_id: VERIFIED_USER_ID,
      role: "super_admin",
      display_name: "Founder",
      active: true,
    },
    verificationError,
    calls,
  });
  const event = {
    httpMethod: "GET",
    headers: {
      authorization: "Bearer test",
      "x-request-id": INJECTED.requestId,
      "x-correlation-id": INJECTED.correlationId,
    },
    queryStringParameters: {},
    body: null,
  };

  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  const testHandler = createMarketplaceVerificationAdminHandler({
    authenticate: authOk(VERIFIED_USER_ID, calls),
    createServerClient: serverClientFactory(client, calls),
  });
  let settled;
  let rejected;
  try {
    settled = await testHandler(event).then(
      (value) => ({ ok: true, value }),
      (reason) => {
        rejected = reason;
        return { ok: false, reason };
      }
    );
  } finally {
    console.error = orig;
  }

  assert.equal(settled.ok, true, "handler promise must resolve, not reject");
  assert.equal(rejected, undefined);
  const response = settled.value;
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), {
    error: PLATFORM_ADMIN_PUBLIC_ERRORS.verification_schema_unavailable.message,
  });
  assertNoInjectionIn(response.body);
  assert.doesNotMatch(response.body, /42P01/);
  assert.doesNotMatch(response.body, new RegExp(VERIFICATION_TABLE));

  const steps = calls.map((c) => c.step);
  assert.ok(steps.includes("authenticate"));
  assert.ok(steps.includes("createServerClient"));
  assert.ok(steps.includes("platform_admins_lookup"));
  assert.ok(steps.includes("verification_select"));
  assert.ok(steps.indexOf("authenticate") < steps.indexOf("createServerClient"));
  assert.ok(steps.indexOf("platform_admins_lookup") < steps.indexOf("verification_select"));

  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.event, "platform_admin_handler_error");
  assert.equal(parsed.category, "platform_admin_unavailable");
  assert.equal(parsed.status, 503);
  assert.match(parsed.requestId, UUID_RE);
  assert.notEqual(parsed.requestId, INJECTED.requestId);
  assert.deepEqual(Object.keys(parsed).sort(), ["category", "event", "requestId", "status", "ts"]);
  assertNoInjectionIn(logs.join(" "));
});

test("marketplace-verification-admin unknown provider error becomes generic 500", async () => {
  const verificationError = Object.assign(
    new Error(`${INJECTED.rawMessage} ${INJECTED.token} ${INJECTED.url}`),
    {
      code: "XX000",
      details: INJECTED.path,
      hint: INJECTED.hostname,
      stack: INJECTED.stack,
    }
  );
  const client = marketplaceVerificationClient({
    adminRow: {
      user_id: VERIFIED_USER_ID,
      role: "super_admin",
      display_name: "Founder",
      active: true,
    },
    verificationError,
  });
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  const testHandler = createMarketplaceVerificationAdminHandler({
    authenticate: authOk(),
    createServerClient: serverClientFactory(client),
  });
  let response;
  try {
    response = await testHandler({
      httpMethod: "GET",
      headers: { authorization: "Bearer test" },
      queryStringParameters: {},
      body: null,
    });
  } finally {
    console.error = orig;
  }
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message);
  assertNoInjectionIn(response.body);
  assertNoInjectionIn(logs.join(" "));
});

test("marketplace-verification-admin missing server key returns branded 503", async () => {
  const testHandler = createMarketplaceVerificationAdminHandler({
    authenticate: authOk(),
    createServerClient: serverClientFactoryThrows(new Error("key missing")),
  });
  const response = await testHandler({
    httpMethod: "GET",
    headers: { authorization: "Bearer test" },
    queryStringParameters: {},
    body: null,
  });
  assert.equal(response.statusCode, 503);
  assert.equal(
    JSON.parse(response.body).error,
    PLATFORM_ADMIN_PUBLIC_ERRORS.server_key_missing.message
  );
});

test("marketplace-verification-admin unauthorized remains 401", async () => {
  const testHandler = createMarketplaceVerificationAdminHandler({
    authenticate: authInvalidToken(),
    createServerClient: serverClientFactory(fakeServerClient()),
  });
  const response = await testHandler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
    body: null,
  });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unauthorized.message);
});

test("marketplace-verification-admin forbidden non-admin remains 403", async () => {
  const emptyAdminClient = fakeServerClient({ rows: [] });
  const testHandler = createMarketplaceVerificationAdminHandler({
    authenticate: authOk(),
    createServerClient: serverClientFactory(emptyAdminClient),
  });
  const response = await testHandler({
    httpMethod: "GET",
    headers: { authorization: "Bearer test" },
    queryStringParameters: {},
    body: null,
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.forbidden.message);
});

// ---------------------------------------------------------------------------
// P0-02 R4: own-property catalog lookup + production handler ignores context deps
// ---------------------------------------------------------------------------

const GENERIC_500 = {
  status: 500,
  message: PLATFORM_ADMIN_PUBLIC_ERRORS.unexpected.message,
  florisynCode: "unexpected",
};

function assertGenericUnexpectedError(err) {
  assert.equal(err.statusCode, GENERIC_500.status);
  assert.equal(err.message, GENERIC_500.message);
  assert.equal(err.florisynCode, GENERIC_500.florisynCode);
  assert.notEqual(err.statusCode, undefined);
  assert.ok(String(err.message).length > 0);
}

function assertGenericUnexpectedResponse(response) {
  assert.equal(response.statusCode, 500);
  assert.notEqual(response.statusCode, undefined);
  const body = JSON.parse(response.body);
  assert.equal(body.error, GENERIC_500.message);
  assert.ok(String(body.error).length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "error"), true);
}

test("platformAdminError rejects prototype and malformed codes via own-property lookup", () => {
  const malformedCodes = [
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
    "",
    "not_a_real_code",
    null,
    undefined,
    Symbol("forbidden"),
  ];
  for (const code of malformedCodes) {
    const err = platformAdminError(code);
    assertGenericUnexpectedError(err);
    const response = platformAdminErrorResponse({}, err);
    assertGenericUnexpectedResponse(response);
  }
});

test("platformAdminErrorResponse treats branded errors with poisoned florisynCode as unexpected 500", () => {
  for (const poisoned of ["toString", "constructor", "__proto__", "hasOwnProperty", "", "nope"]) {
    const err = platformAdminError("forbidden");
    err.florisynCode = poisoned;
    const response = platformAdminErrorResponse({}, err);
    assertGenericUnexpectedResponse(response);
  }
});

const PRODUCTION_HANDLERS = [
  ["admin-console", adminConsoleHandler],
  ["admin-command-center", adminCommandCenterHandler],
  ["marketplace-verification-admin", marketplaceVerificationAdminHandler],
  ["floral-library-admin", floralLibraryAdminHandler],
  ["admin-photo-manager", adminPhotoManagerHandler],
];

for (const [name, productionHandler] of PRODUCTION_HANDLERS) {
  test(`production ${name} handler ignores Netlify-context dependency overrides`, async () => {
    let authenticateCalls = 0;
    let createServerClientCalls = 0;
    let fromCalls = 0;
    const fakeAuthenticate = async () => {
      authenticateCalls += 1;
      return { user: { id: VERIFIED_USER_ID }, usesServiceRole: false };
    };
    const fakeCreateServerClient = () => {
      createServerClientCalls += 1;
      return {
        from(table) {
          fromCalls += 1;
          throw new Error(`fake client must not query ${table}`);
        },
      };
    };
    const response = await productionHandler(
      {
        httpMethod: "GET",
        headers: {},
        queryStringParameters: {},
        body: null,
      },
      {
        authenticate: fakeAuthenticate,
        createServerClient: fakeCreateServerClient,
        callbackWaitsForEmptyEventLoop: true,
      }
    );
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).error, PLATFORM_ADMIN_PUBLIC_ERRORS.unauthorized.message);
    assert.equal(authenticateCalls, 0);
    assert.equal(createServerClientCalls, 0);
    assert.equal(fromCalls, 0);
  });
}

test("resolvePlatformAdminHandlerDeps is removed from platform-admin and handlers", () => {
  const shared = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/platform-admin.js"),
    "utf8"
  );
  assert.doesNotMatch(shared, /resolvePlatformAdminHandlerDeps/);
  for (const file of EXPECTED_PLATFORM_ADMIN_CALL_SITES) {
    const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions", file), "utf8");
    assert.doesNotMatch(src, /resolvePlatformAdminHandlerDeps/);
    assert.match(src, /create\w+Handler/);
    assert.match(src, /export const handler = create/);
  }
});
