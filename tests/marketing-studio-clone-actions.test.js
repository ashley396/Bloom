import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Stage G's admin-console UI added two new marketing-studio.js actions:
// upload_clone_reference_photo (hosts a reference photo somewhere HeyGen
// can fetch it from) and clone_job_status (polls a HeyGen video render).
// Both sit behind the same MARKETING_STUDIO feature flag + super_admin
// gate as every other action in this handler.

const ONE_BY_ONE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}

let originalFlag, originalHeygenKey, originalElevenLabsKey, originalFetch;
test.before(() => {
  originalFlag = process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  originalHeygenKey = process.env.HEYGEN_API_KEY;
  originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;
  originalFetch = globalThis.fetch;
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = originalFlag;
  process.env.HEYGEN_API_KEY = originalHeygenKey;
  process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
  globalThis.fetch = originalFetch;
});

test("upload_clone_reference_photo: requires a shop_id before touching storage", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "upload_clone_reference_photo", data_url: ONE_BY_ONE_PNG })
  });
  assert.equal(res.statusCode, 400);
});

test("upload_clone_reference_photo: requires data_url", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "upload_clone_reference_photo", shop_id: "shop-1" })
  });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /data_url/);
});

test("upload_clone_reference_photo: a non-super_admin is rejected before any upload", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }], { storage });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "upload_clone_reference_photo", shop_id: "shop-1", data_url: ONE_BY_ONE_PNG })
  });
  assert.equal(res.statusCode, 403);
  assert.equal(storage.calls.length, 0, "must never reach storage for a non-super_admin caller");
});

test("upload_clone_reference_photo: uploads to the public website-media bucket and returns a real public URL", async () => {
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://cdn.example.com/website-media/${path}` });
  const client = createFakeSupabaseClient([superAdminRow()], { storage });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "upload_clone_reference_photo", shop_id: "shop-1", data_url: ONE_BY_ONE_PNG, filename: "ashley.png" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.url, /^https:\/\/cdn\.example\.com\/website-media\/shop-1\//);
  const upload = storage.calls.find((c) => c.op === "upload");
  assert.equal(upload.bucket, "website-media");
  assert.match(upload.path, /^shop-1\//);
});

test("upload_clone_reference_photo: an invalid image encoding surfaces the real validation error, not a generic 500", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "upload_clone_reference_photo", shop_id: "shop-1", data_url: "not-a-real-data-url" })
  });
  assert.equal(res.statusCode, 400);
});

test("clone_job_status: requires a shop_id", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", job_id: "vid-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 400);
});

test("clone_job_status: requires a job_id", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 400);
});

test("clone_job_status: honestly reports NOT LIVE when no clone provider is configured, never fabricates a status", async () => {
  delete process.env.HEYGEN_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1", job_id: "vid-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).note, /NOT LIVE/);
});

test("clone_job_status: once both provider keys are configured, polls the real HeyGen video-status endpoint", async () => {
  process.env.HEYGEN_API_KEY = "heygen-key";
  process.env.ELEVENLABS_API_KEY = "elevenlabs-key";
  let capturedUrl, capturedHeaders;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = init.headers;
    return { ok: true, json: async () => ({ data: { status: "completed", video_url: "https://cdn.heygen.com/x.mp4" } }) };
  };
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1", job_id: "vid-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "completed");
  assert.equal(body.terminal, true);
  assert.equal(body.resultUrl, "https://cdn.heygen.com/x.mp4");
  assert.match(capturedUrl, /video_id=vid-1/);
  assert.equal(capturedHeaders["x-api-key"], "heygen-key");
});

test("clone_job_status: a provider-side failure surfaces as a real 502, never a fabricated status", async () => {
  process.env.HEYGEN_API_KEY = "heygen-key";
  process.env.ELEVENLABS_API_KEY = "elevenlabs-key";
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API key" } }) });
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1", job_id: "vid-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /Invalid API key/);
});
