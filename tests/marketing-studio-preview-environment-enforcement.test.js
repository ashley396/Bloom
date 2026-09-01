import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

/**
 * Batch 6, Part B / independent-review finding (Part S): the preview
 * environment guard existed but was never actually called from any real
 * Marketing generation entry point — only from a separate advisory
 * status route nobody was forced to consult. This proves the fix: the
 * SAME shared dispatch every real action (generate_content,
 * revise_content, finalize_flyer_render, approve_content, and every
 * other action) goes through now genuinely refuses a request whose
 * environment claims to be a preview/staging deploy but doesn't actually
 * pass the real safety check — BEFORE any auth/DB work happens — and is
 * a true no-op for a genuine production deploy (which never sets
 * FLORISYN_ENV/MARKETING_STUDIO_PREVIEW at all).
 */

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}

function event(action, body = {}, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

test("a request claiming FLORISYN_ENV=preview but pointed at the real production site URL is refused (412) BEFORE any DB query runs, for an ordinary action", async () => {
  process.env.FLORISYN_ENV = "preview";
  process.env.SITE_URL = "https://www.florisyn.com";
  const client = createFakeSupabaseClient([]); // empty queue — a real query would throw "no response queued"
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", {}, { method: "GET" }));
  assert.equal(res.statusCode, 412);
  const body = JSON.parse(res.body);
  assert.match(body.error, /production Florisyn domain|Unsafe Marketing preview environment/i);
  assert.ok(Array.isArray(body.violations) && body.violations.length > 0);
  assert.equal(client.calls.length, 0, "no DB query may run once the environment guard has already refused the request");
});

test("a request claiming to be preview but with real social-publishing credentials present is refused before generate_content-shaped actions reach any provider/DB work", async () => {
  process.env.FLORISYN_ENV = "preview";
  process.env.SITE_URL = "https://deploy-preview-1--florisyn-marketing-staging.netlify.app";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "real-production-looking-client-id";
  const client = createFakeSupabaseClient([]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { content_item_id: "item-1" }));
  assert.equal(res.statusCode, 412);
  assert.match(JSON.parse(res.body).error, /publishing credentials/i);
  assert.equal(client.calls.length, 0);
});

test("a request claiming to be preview but with SOCIAL_PUBLISHING_ENABLED=true is refused for approve_content too — not scoped to just one action", async () => {
  process.env.FLORISYN_ENV = "staging";
  process.env.SOCIAL_PUBLISHING_ENABLED = "true";
  const client = createFakeSupabaseClient([]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 412);
  assert.equal(client.calls.length, 0);
});

test("a genuinely safe preview environment is unaffected — the request proceeds to the real handler logic exactly as before", async () => {
  process.env.FLORISYN_ENV = "preview";
  process.env.SITE_URL = "https://deploy-preview-1--florisyn-marketing-staging.netlify.app";
  process.env.SOCIAL_PUBLISHING_ENABLED = "false";
  process.env.SCHEDULED_PUBLISHING_ENABLED = "false";
  delete process.env.SUPABASE_URL;
  delete process.env.PRODUCTION_SUPABASE_HOST;
  const client = createFakeSupabaseClient([{ data: { id: "shop-1" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", {}, { method: "GET" }));
  // "status" doesn't error even with an unused queued response — what
  // matters is it's NOT the guard's 412.
  assert.notEqual(res.statusCode, 412);
});

test("a genuine production deploy (no FLORISYN_ENV/MARKETING_STUDIO_PREVIEW set at all) is a complete no-op for this guard — never accidentally refused", async () => {
  delete process.env.FLORISYN_ENV;
  delete process.env.MARKETING_STUDIO_PREVIEW;
  // Deliberately production-shaped values that WOULD fail the preview
  // checks if they were ever run — proving the guard truly never runs
  // for a deploy that isn't claiming to be preview at all.
  process.env.SITE_URL = "https://www.florisyn.com";
  process.env.SOCIAL_PUBLISHING_ENABLED = "true";
  const client = createFakeSupabaseClient([{ data: { id: "shop-1" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", {}, { method: "GET" }));
  assert.notEqual(res.statusCode, 412, "a real production deploy's own real configuration must never trip the preview-only guard");
});
