import test from "node:test";
import assert from "node:assert/strict";
import { corsOrigin, json, preflight } from "../netlify/functions/_shared/http.js";

test("corsOrigin uses SITE_URL and trims trailing slash", () => {
  assert.equal(corsOrigin({ SITE_URL: "https://florisyn-staging.netlify.app/" }), "https://florisyn-staging.netlify.app");
});

test("corsOrigin falls back to staging without wildcard or localhost", () => {
  assert.equal(corsOrigin({}), "https://florisyn-staging.netlify.app");
  assert.notEqual(corsOrigin({}), "*");
  assert.doesNotMatch(corsOrigin({}), /localhost/i);
});

test("corsOrigin reflects allowlisted request Origin", () => {
  assert.equal(
    corsOrigin({ SITE_URL: "https://florisyn-staging.netlify.app" }, "https://www.florisyn.com"),
    "https://www.florisyn.com"
  );
  assert.equal(
    corsOrigin({ SITE_URL: "https://florisyn-staging.netlify.app" }, "https://evil.example"),
    "https://florisyn-staging.netlify.app"
  );
});

test("json includes locked CORS origin, security headers, and Vary", () => {
  const r = json(200, { ok: true }, { URL: "https://florisyn-staging.netlify.app" });
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://florisyn-staging.netlify.app");
  assert.equal(r.headers.Vary, "Origin");
  assert.equal(r.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(r.headers["X-Frame-Options"], "DENY");
  assert.notEqual(r.headers["Access-Control-Allow-Origin"], "*");
});

test("preflight returns no-store CORS response", () => {
  const r = preflight({ httpMethod: "OPTIONS" }, { SITE_URL: "https://florisyn-staging.netlify.app" });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://florisyn-staging.netlify.app");
});
