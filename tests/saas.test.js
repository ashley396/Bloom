import test from "node:test";
import assert from "node:assert/strict";
import { env, admin, json, fail, slugify } from "../netlify/functions/_shared/saas.js";

// saas.js had only 57.5% coverage despite housing the env/admin-client
// bootstrap and the fail() handler that decides what error detail (if
// any) reaches an API client — a real security-relevant boundary.

test("env: returns the trimmed value of a real, present env var", () => {
  const original = process.env.FLORISYN_TEST_ENV_VAR;
  process.env.FLORISYN_TEST_ENV_VAR = "  hello  ";
  try {
    assert.equal(env("FLORISYN_TEST_ENV_VAR"), "hello");
  } finally {
    if (original === undefined) delete process.env.FLORISYN_TEST_ENV_VAR;
    else process.env.FLORISYN_TEST_ENV_VAR = original;
  }
});

test("env: a missing or blank env var throws a 503 naming which var is missing, not a generic crash", () => {
  const original = process.env.FLORISYN_TEST_MISSING_VAR;
  delete process.env.FLORISYN_TEST_MISSING_VAR;
  try {
    assert.throws(
      () => env("FLORISYN_TEST_MISSING_VAR"),
      (err) => {
        assert.equal(err.statusCode, 503);
        assert.match(err.message, /FLORISYN_TEST_MISSING_VAR/);
        return true;
      }
    );
  } finally {
    if (original !== undefined) process.env.FLORISYN_TEST_MISSING_VAR = original;
  }
});

test("admin: with no server key configured at all, throws a clear 503 with the founder-key-missing code", () => {
  const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedSecret = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    assert.throws(
      () => admin(),
      (err) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, "supabase_server_key_missing");
        return true;
      }
    );
  } finally {
    if (savedRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole;
    if (savedSecret !== undefined) process.env.SUPABASE_SECRET_KEY = savedSecret;
  }
});

test("admin: with a server key but no SUPABASE_URL, throws the env() error naming SUPABASE_URL specifically (not a swallowed/confusing failure)", () => {
  const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-for-test";
  delete process.env.SUPABASE_URL;
  try {
    assert.throws(
      () => admin(),
      (err) => {
        assert.equal(err.statusCode, 503);
        assert.match(err.message, /SUPABASE_URL/);
        return true;
      }
    );
  } finally {
    if (savedRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
  }
});

test("admin: with both a server key and SUPABASE_URL present, successfully constructs a client (no network call at construction time)", () => {
  const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-for-test";
  process.env.SUPABASE_URL = "https://fake-project.supabase.co/";
  try {
    const client = admin();
    assert.ok(client);
    assert.equal(typeof client.from, "function", "must return a real supabase-js client, not a stub");
  } finally {
    if (savedRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
    else delete process.env.SUPABASE_URL;
  }
});

test("json: builds a real HTTP response shape with security headers and a JSON-serialized body", () => {
  const res = json(201, { id: "abc" });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.deepEqual(JSON.parse(res.body), { id: "abc" });
});

test("fail: a real 4xx error's own message reaches the client", () => {
  const err = new Error("Shop not found");
  err.statusCode = 404;
  const res = fail(err);
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, "Shop not found");
});

test("fail: a 500+ (or code-less) error is masked to a generic message — internal detail never leaks to the client", () => {
  const err = new Error("TypeError: cannot read x of undefined at internal/db.js:99");
  const res = fail(err);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, "Unexpected error");
});

test("fail: an error with no statusCode at all still defaults to a masked 500, not a leak", () => {
  const res = fail(new Error("raw internal detail"));
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, "Unexpected error");
});

test("slugify: lowercases, trims, and hyphenates a real shop name", () => {
  assert.equal(slugify("  Bloom & Co. Florist!  "), "bloom-co-florist");
});

test("slugify: collapses repeated separators into a single hyphen and strips leading/trailing ones", () => {
  assert.equal(slugify("--Rose   Garden--"), "rose-garden");
});

test("slugify: caps length at 48 characters", () => {
  const long = "a".repeat(100);
  assert.equal(slugify(long).length, 48);
});

test("slugify: empty/missing input produces an empty string, not 'undefined' or 'null'", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
});
