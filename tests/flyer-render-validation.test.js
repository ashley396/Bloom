import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFlyerRenderDataUrl,
  flyerApprovalBlockReason,
  contentApprovalBlockReason,
  verifyFlyerStorageObjectExists,
  FLYER_RENDER_MAX_BYTES,
  FLYER_RENDER_MIN_DIMENSION,
  FLYER_RENDER_MAX_DIMENSION
} from "../netlify/functions/_shared/flyer-render.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Hardening pass (before-approval security/durability review): a real PNG
 * file-signature check, a decoded byte-size ceiling, malformed-base64
 * rejection, and real width/height read from the PNG's own IHDR chunk —
 * never trusting the claimed "image/png" MIME prefix alone. No image
 * library needed for these bytes: the signature is always the same 8
 * bytes, and IHDR is always the very first chunk at a fixed offset in a
 * valid PNG, so a minimal, CRC-agnostic buffer (this validator never checks
 * chunk CRCs) is a real, honest PNG as far as this function is concerned.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function makePngBuffer(width, height, { padBytes = 0 } = {}) {
  const buf = Buffer.alloc(33 + padBytes);
  buf.set(PNG_SIGNATURE, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function toDataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

test("validateFlyerRenderDataUrl: accepts a real, in-bounds PNG and reports its true dimensions", () => {
  const result = validateFlyerRenderDataUrl(toDataUrl(makePngBuffer(1080, 1080)));
  assert.equal(result.valid, true);
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1080);
  assert.ok(Buffer.isBuffer(result.buffer));
});

test("validateFlyerRenderDataUrl: rejects a decoded payload over the byte-size ceiling", () => {
  const oversized = makePngBuffer(1080, 1080, { padBytes: FLYER_RENDER_MAX_BYTES + 1024 });
  const result = validateFlyerRenderDataUrl(toDataUrl(oversized));
  assert.equal(result.valid, false);
  assert.match(result.error, /MB/i);
});

test("validateFlyerRenderDataUrl: rejects real bytes that aren't actually a PNG, regardless of the claimed MIME", () => {
  // A real JPEG signature (FF D8 FF), labeled as image/png in the data:
  // URL prefix — proves the check reads the actual bytes, not the label.
  const notReallyPng = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
  const result = validateFlyerRenderDataUrl(toDataUrl(notReallyPng));
  assert.equal(result.valid, false);
  assert.match(result.error, /doesn't look like a real PNG/i);
});

test("validateFlyerRenderDataUrl: rejects a claimed image/svg+xml or image/jpeg outright — only PNG is ever accepted", () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)></svg>").toString("base64");
  const jpeg = toDataUrl(makePngBuffer(1080, 1080), "image/jpeg"); // real PNG bytes, wrong claimed MIME
  for (const dataUrl of [svg, jpeg]) {
    const result = validateFlyerRenderDataUrl(dataUrl);
    assert.equal(result.valid, false, `expected "${dataUrl.slice(0, 30)}..." to be rejected`);
    assert.match(result.error, /only PNG/i);
  }
});

test("validateFlyerRenderDataUrl: rejects malformed base64", () => {
  const result = validateFlyerRenderDataUrl("data:image/png;base64,not-valid-base64!!!***");
  assert.equal(result.valid, false);
  assert.match(result.error, /malformed/i);
});

test("validateFlyerRenderDataUrl: rejects an empty file", () => {
  const result = validateFlyerRenderDataUrl("data:image/png;base64,");
  assert.equal(result.valid, false);
});

test("validateFlyerRenderDataUrl: rejects a non-data-url string entirely (undefined, plain text, an HTML payload)", () => {
  for (const bad of [undefined, null, "", "<html>not an image</html>", "https://example.com/not-a-data-url.png"]) {
    const result = validateFlyerRenderDataUrl(bad);
    assert.equal(result.valid, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("validateFlyerRenderDataUrl: rejects dimensions outside a reasonable flyer-render range", () => {
  const tooSmall = validateFlyerRenderDataUrl(toDataUrl(makePngBuffer(FLYER_RENDER_MIN_DIMENSION - 1, FLYER_RENDER_MIN_DIMENSION - 1)));
  assert.equal(tooSmall.valid, false);
  assert.match(tooSmall.error, /dimensions/i);

  const tooLarge = validateFlyerRenderDataUrl(toDataUrl(makePngBuffer(FLYER_RENDER_MAX_DIMENSION + 1, FLYER_RENDER_MAX_DIMENSION + 1)));
  assert.equal(tooLarge.valid, false);
  assert.match(tooLarge.error, /dimensions/i);
});

// ── flyerApprovalBlockReason — the full approve_content readiness gate ──

const VALID_FLYER_CONTENT = { url: "https://fake.storage/website-media/shop-1/flyers/asset-1.png", storage_path: "shop-1/flyers/asset-1.png", mime: "image/png", render_status: "rendered" };

test("flyerApprovalBlockReason: a genuinely finalized flyer is approvable (no block reason)", () => {
  assert.equal(flyerApprovalBlockReason({ asset_type: "flyer", content: VALID_FLYER_CONTENT }), null);
});

test("flyerApprovalBlockReason: null/undefined asset, or a non-flyer asset_type, is never blocked by this gate — it only applies to flyers", () => {
  assert.equal(flyerApprovalBlockReason(null), null);
  assert.equal(flyerApprovalBlockReason(undefined), null);
  assert.equal(flyerApprovalBlockReason({ asset_type: "image", content: {} }), null);
});

test("flyerApprovalBlockReason: blocks when render_status isn't \"rendered\" — a non-null url alone is not enough (forged/partial content)", () => {
  const reason = flyerApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, render_status: null } });
  assert.ok(reason);
});

test("flyerApprovalBlockReason: blocks a forged non-https url even when render_status claims \"rendered\"", () => {
  for (const url of ["javascript:alert(1)", "http://example.com/flyer.png", "data:image/png;base64,AAAA", ""]) {
    const reason = flyerApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, url } });
    assert.ok(reason, `expected url "${url}" to be blocked`);
  }
});

test("flyerApprovalBlockReason: blocks when storage_path is missing — proof the url actually came from finalize_flyer_render, not a hand-crafted content blob", () => {
  const reason = flyerApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, storage_path: null } });
  assert.ok(reason);
});

test("flyerApprovalBlockReason: blocks an unsupported mime", () => {
  const reason = flyerApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, mime: "image/svg+xml" } });
  assert.ok(reason);
});

test("flyerApprovalBlockReason: blocks a quarantined flyer even if every other field is otherwise valid", () => {
  const reason = flyerApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, quarantined: true } });
  assert.ok(reason);
  assert.match(reason, /flagged/i);
});

// ── contentApprovalBlockReason — Batch 3, Part D/E: the full approve_content
// readiness gate across every asset type, not just flyers.

test("contentApprovalBlockReason: delegates to flyerApprovalBlockReason unchanged for a flyer", () => {
  assert.equal(contentApprovalBlockReason({ asset_type: "flyer", content: VALID_FLYER_CONTENT }), null);
  const blocked = contentApprovalBlockReason({ asset_type: "flyer", content: { ...VALID_FLYER_CONTENT, render_status: null } });
  assert.ok(blocked);
});

test("contentApprovalBlockReason: blocks the REAL quarantine signal (asset.status), not just the content.quarantined placeholder nothing sets", () => {
  const reason = contentApprovalBlockReason({ asset_type: "image", status: "quarantined", content: { url: "https://example.com/x.jpg" } });
  assert.ok(reason);
  assert.match(reason, /flagged/i);
});

test("contentApprovalBlockReason: an 'image' asset requires a real, trusted current photo url", () => {
  assert.ok(contentApprovalBlockReason({ asset_type: "image", content: {} }));
  assert.ok(contentApprovalBlockReason({ asset_type: "image", content: { url: "http://not-https.example.com/x.jpg" } }));
  assert.equal(contentApprovalBlockReason({ asset_type: "image", content: { url: "https://fake.storage/x.jpg" } }), null);
});

test("contentApprovalBlockReason: text-only asset types (social_copy, video_concept) carry no extra requirement — never held to flyer/image rules", () => {
  assert.equal(contentApprovalBlockReason({ asset_type: "social_copy", content: { body: "a real caption" } }), null);
  assert.equal(contentApprovalBlockReason({ asset_type: "video_concept", content: { script: "..." } }), null);
});

test("contentApprovalBlockReason: null/undefined asset is never blocked by this gate", () => {
  assert.equal(contentApprovalBlockReason(null), null);
  assert.equal(contentApprovalBlockReason(undefined), null);
});

// ── verifyFlyerStorageObjectExists — Batch 3, Part F: real storage
// verification, never trusting the DB row's own claim alone.

test("verifyFlyerStorageObjectExists: verified true when the object is actually found by a real .list() check", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: [{ name: "flyer-1.png" }], error: null }] });
  const client = createFakeSupabaseClient([], { storage });
  const result = await verifyFlyerStorageObjectExists(client, "shop-1/flyers/flyer-1.png");
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  const listCall = storage.calls.find((c) => c.op === "list");
  assert.equal(listCall.path, "shop-1/flyers");
  assert.equal(listCall.options.search, "flyer-1.png");
});

test("verifyFlyerStorageObjectExists: verified false (not ok:false) when the list succeeds but the file genuinely isn't there", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: [], error: null }] });
  const client = createFakeSupabaseClient([], { storage });
  const result = await verifyFlyerStorageObjectExists(client, "shop-1/flyers/flyer-1.png");
  assert.equal(result.ok, true, "the CHECK itself succeeded — it just found nothing");
  assert.equal(result.verified, false);
});

test("verifyFlyerStorageObjectExists: ok:false (never verified:true) on a real storage error", async () => {
  const storage = createFakeSupabaseStorage({ listResponses: [{ data: null, error: { message: "storage down" } }] });
  const client = createFakeSupabaseClient([], { storage });
  const result = await verifyFlyerStorageObjectExists(client, "shop-1/flyers/flyer-1.png");
  assert.equal(result.ok, false);
  assert.match(result.error, /storage down/);
});

test("verifyFlyerStorageObjectExists: ok:false on a missing/empty storage_path — nothing to verify is never treated as verified", async () => {
  const client = createFakeSupabaseClient([], { storage: createFakeSupabaseStorage({}) });
  assert.equal((await verifyFlyerStorageObjectExists(client, null)).ok, false);
  assert.equal((await verifyFlyerStorageObjectExists(client, "")).ok, false);
});

test("verifyFlyerStorageObjectExists: ok:false, never throws, when the storage client itself is unavailable", async () => {
  const throwingClient = { storage: { from: () => { throw new Error("no storage configured"); } } };
  const result = await verifyFlyerStorageObjectExists(throwingClient, "shop-1/flyers/flyer-1.png");
  assert.equal(result.ok, false);
  assert.match(result.error, /no storage configured/);
});
