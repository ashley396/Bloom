import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../netlify/functions/marketing-preview-status.js";

// Batch 6, Part B/D: the one route that surfaces both the preview
// environment guard's verdict and the build stamp together.

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("marketing-preview-status: reports safeForMarketingPreview:false with real violation messages for an unsafe (default) environment", async () => {
  const res = await handler({ httpMethod: "GET" });
  assert.equal(res.statusCode, 412);
  const body = JSON.parse(res.body);
  assert.equal(body.safeForMarketingPreview, false);
  assert.ok(Array.isArray(body.violations) && body.violations.length > 0);
  assert.ok("build" in body, "the build field must always be present, even when null");
});

test("marketing-preview-status: reports safeForMarketingPreview:true for a genuinely safe preview environment", async () => {
  process.env.FLORISYN_ENV = "preview";
  process.env.SITE_URL = "https://deploy-preview-1--florisyn-marketing-staging.netlify.app";
  process.env.SOCIAL_PUBLISHING_ENABLED = "false";
  process.env.SCHEDULED_PUBLISHING_ENABLED = "false";
  delete process.env.SUPABASE_URL;
  delete process.env.PRODUCTION_SUPABASE_HOST;
  const res = await handler({ httpMethod: "GET" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.safeForMarketingPreview, true);
  assert.deepEqual(body.violations, []);
});

test("marketing-preview-status: rejects a non-GET request", async () => {
  const res = await handler({ httpMethod: "POST" });
  assert.equal(res.statusCode, 405);
});

test("marketing-preview-status: never exposes a credential value — only the guard's own violation messages and public build metadata", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "super-secret-value-must-not-leak";
  const res = await handler({ httpMethod: "GET" });
  assert.doesNotMatch(res.body, /super-secret-value-must-not-leak/);
  delete process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET;
});
