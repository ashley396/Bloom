import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  executeImageReframe,
  transformImageForDestination,
  transformMasterImageForPlatforms
} from "../netlify/functions/_shared/creative-ai/media-transform-executor.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Priority 4 ("as far as technically possible" pass): REAL image
// transformation execution via sharp — proves this is not just a plan for
// the image case. Video stays plan-only (see marketing-video-render-engine
// tests) — no ffmpeg/video provider exists.

let realImageServer;
let realImageUrl;

test.before(async () => {
  // A genuine 400x400 JPEG, served over real HTTP — fetchImageBuffer()
  // only trusts http(s) URLs, so this proves the whole real fetch->sharp
  // ->reupload pipeline, not just the sharp call in isolation.
  const buffer = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 50, b: 120 } } }).jpeg().toBuffer();
  const http = await import("node:http");
  realImageServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(buffer);
  });
  await new Promise((resolve) => realImageServer.listen(0, resolve));
  const { port } = realImageServer.address();
  realImageUrl = `http://127.0.0.1:${port}/source.jpg`;
});

test.after(() => {
  realImageServer?.close();
});

function shopClient(responses) {
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  return createFakeSupabaseClient(responses, { storage });
}

test("executeImageReframe: really downloads, really crops/resizes with sharp, and really re-uploads a derivative image", async () => {
  const client = shopClient([]); // uploadWebsiteMedia goes through storage.upload, not a table row
  const result = await executeImageReframe(client, "shop-1", { sourceUrl: realImageUrl, aspectRatio: "9:16" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.ok(result.url.startsWith("https://fake.storage/"));

  // Prove it's a REAL image, not a stub: re-decode the exact bytes that
  // were handed to storage.upload with sharp and check its real,
  // independently-measured pixel dimensions match what the function
  // claimed — this can only pass if sharp actually ran a real resize.
  const uploadCall = client.storage.calls.find((c) => c.op === "upload");
  assert.ok(uploadCall, "expected a real storage.upload call");
  // uploadWebsiteMedia decodes the data URL into a real Buffer before
  // calling storage.upload — re-decode those exact bytes with sharp.
  const reDecoded = await sharp(uploadCall.body).metadata();
  assert.equal(reDecoded.width, 1080);
  assert.equal(reDecoded.height, 1920);
  assert.equal(reDecoded.format, "jpeg");
});

test("executeImageReframe: rejects a non-http(s) source URL rather than attempting to read it", async () => {
  const client = shopClient([]);
  const result = await executeImageReframe(client, "shop-1", { sourceUrl: "file:///etc/passwd", aspectRatio: "1:1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /http\(s\)/i);
});

test("executeImageReframe: an unreachable source URL fails honestly, never fabricating a result", async () => {
  const client = shopClient([]);
  const result = await executeImageReframe(client, "shop-1", { sourceUrl: "http://127.0.0.1:1/nope.jpg", aspectRatio: "1:1" });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("executeImageReframe: an unknown aspect ratio is a clean error, not a crash", async () => {
  const client = shopClient([]);
  const result = await executeImageReframe(client, "shop-1", { sourceUrl: realImageUrl, aspectRatio: "3:1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown aspect ratio/i);
});

test("transformImageForDestination: requires parentAssetId — never creates a derived-asset row with no master (DB constraint match)", async () => {
  const client = shopClient([]);
  const result = await transformImageForDestination(client, { shopId: "shop-1", sourceUrl: realImageUrl, aspectRatio: "1:1", destination: "facebook_feed" });
  assert.equal(result.ok, false);
  assert.match(result.error, /parentAssetId/);
});

test("transformImageForDestination: on success, persists a real derived ai_generated_assets row with transformation_type='reframe' and the master's parent_asset_id", async () => {
  const client = shopClient([
    { data: { id: "derived-1", transformation_type: "reframe", parent_asset_id: "master-1" }, error: null } // persistGeneratedAsset insert
  ]);
  const result = await transformImageForDestination(client, {
    shopId: "shop-1",
    userId: "u1",
    parentAssetId: "master-1",
    sourceUrl: realImageUrl,
    aspectRatio: "4:5",
    destination: "instagram_feed"
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.assetId, "derived-1");
  const insertCall = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.transformation_type, "reframe");
  assert.equal(insertCall.payload.parent_asset_id, "master-1");
  assert.equal(insertCall.payload.asset_type, "image");
});

test("transformMasterImageForPlatforms: skips a destination whose spec already matches the master's aspect ratio (no wasted reframe)", async () => {
  const client = shopClient([]);
  // 16:9 already satisfies facebook_feed's own aspect ratio list.
  const result = await transformMasterImageForPlatforms(client, {
    shopId: "shop-1",
    masterAssetId: "master-1",
    masterUrl: realImageUrl,
    masterAspectRatio: "16:9",
    targetPlatforms: ["facebook"]
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].executed, false);
  assert.equal(result.results[0].reason, "master_aspect_ratio_already_fits");
  assert.equal(result.results[0].url, realImageUrl);
});

test("transformMasterImageForPlatforms: really executes a reframe for a destination that needs one", async () => {
  const client = shopClient([
    { data: { id: "derived-1" }, error: null } // one reframe needed (instagram_reels from a 1:1 master)
  ]);
  const result = await transformMasterImageForPlatforms(client, {
    shopId: "shop-1",
    masterAssetId: "master-1",
    masterUrl: realImageUrl,
    masterAspectRatio: "1:1",
    targetPlatforms: ["tiktok"] // tiktok only accepts 9:16 — always needs a reframe from a 1:1 master
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].executed, true);
  assert.equal(result.results[0].ok, true, result.results[0].error);
  assert.equal(result.results[0].destination, "tiktok");
});
