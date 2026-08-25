import test from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_PROOF_BUCKET,
  isStoragePath,
  uploadDeliveryProof,
  attachDeliveryProofUrls,
  validateProofCaptureBody,
} from "../netlify/functions/_shared/delivery-proof.js";
import { createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// delivery-proof.js had only 52.7% coverage despite gating what actually
// gets stored (and later signed-url'd) as legal proof-of-delivery — a
// bug here either loses a real photo or leaks a signed URL for a value
// that was never actually a storage path.

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("isStoragePath: a real bucket-relative path is a storage path", () => {
  assert.equal(isStoragePath("shop-1/1700000000-abc.jpg"), true);
});

test("isStoragePath: an http(s) URL is never a storage path, even with slashes", () => {
  assert.equal(isStoragePath("https://example.com/photo.jpg"), false);
  assert.equal(isStoragePath("http://example.com/photo.jpg"), false);
});

test("isStoragePath: empty/missing value is not a storage path", () => {
  assert.equal(isStoragePath(""), false);
  assert.equal(isStoragePath(null), false);
});

test("isStoragePath: a bare filename with no slash is not treated as a storage path", () => {
  assert.equal(isStoragePath("photo.jpg"), false);
});

test("uploadDeliveryProof: no dataUrl at all is a clean no-op, not an error", async () => {
  const result = await uploadDeliveryProof({}, "shop-1", null);
  assert.deepEqual(result, { ok: true, path: null });
});

test("uploadDeliveryProof: a malformed data URL (not the data:<mime>;base64,<data> shape) is rejected before ever touching storage", async () => {
  const result = await uploadDeliveryProof({}, "shop-1", "not-a-data-url-at-all");
  assert.equal(result.ok, false);
  assert.match(result.error, /valid image|encoding/i);
});

test("uploadDeliveryProof: an unsupported mime type is rejected before touching storage", async () => {
  const result = await uploadDeliveryProof({}, "shop-1", "data:application/pdf;base64,JVBERi0xLjQK");
  assert.equal(result.ok, false);
  assert.match(result.error, /JPEG, PNG, or WebP/);
});

test("uploadDeliveryProof: a valid image uploads to the shop-scoped bucket path with the right extension", async () => {
  const storage = createFakeSupabaseStorage();
  const client = { storage };
  const result = await uploadDeliveryProof(client, "shop-42", TINY_PNG_DATA_URL);
  assert.equal(result.ok, true);
  assert.match(result.path, /^shop-42\/\d+-[0-9a-f-]{36}\.png$/);
  assert.equal(result.mime, "image/png");
  assert.ok(result.sizeBytes > 0);
  const uploadCall = storage.calls.find((c) => c.op === "upload");
  assert.equal(uploadCall.bucket, DELIVERY_PROOF_BUCKET);
  assert.equal(uploadCall.options.contentType, "image/png");
  assert.equal(uploadCall.options.upsert, false, "must never silently overwrite an existing proof photo");
});

test("uploadDeliveryProof: a storage-layer failure is reported through the result, not thrown", async () => {
  const storage = createFakeSupabaseStorage({ uploadResponses: [{ data: null, error: { message: "bucket full" } }] });
  const client = { storage };
  const result = await uploadDeliveryProof(client, "shop-1", TINY_PNG_DATA_URL);
  assert.deepEqual(result, { ok: false, error: "bucket full" });
});

test("attachDeliveryProofUrls: an item with no proof photo at all gets a null signed url, not an error", async () => {
  const results = await attachDeliveryProofUrls({ storage: createFakeSupabaseStorage() }, [{ id: 1 }]);
  assert.deepEqual(results[0], { id: 1, proof_signed_url: null, proof_url_expires_in: null });
});

test("attachDeliveryProofUrls: an http(s) url on the item is passed through as not-a-storage-path, never signed", async () => {
  const storage = createFakeSupabaseStorage();
  const results = await attachDeliveryProofUrls({ storage }, [{ id: 2, proof_photo_url: "https://cdn.example.com/x.jpg" }]);
  assert.equal(results[0].proof_signed_url, null);
  assert.equal(storage.calls.length, 0, "must never attempt to sign a URL that was never a real storage path");
});

test("attachDeliveryProofUrls: a real storage path is signed with the correct bucket and TTL", async () => {
  const storage = createFakeSupabaseStorage();
  // createSignedUrl isn't in the shared storage fake's public surface — add it directly.
  storage.from = (bucket) => ({
    createSignedUrl(path, seconds) {
      storage.calls.push({ op: "createSignedUrl", bucket, path, seconds });
      return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null });
    },
  });
  const results = await attachDeliveryProofUrls({ storage }, [{ id: 3, proof_photo_url: "shop-1/photo.jpg" }]);
  assert.equal(results[0].proof_signed_url, "https://signed.example/shop-1/photo.jpg");
  assert.equal(results[0].proof_url_expires_in, 300);
  const signCall = storage.calls.find((c) => c.op === "createSignedUrl");
  assert.equal(signCall.bucket, DELIVERY_PROOF_BUCKET);
  assert.equal(signCall.seconds, 300);
});

test("attachDeliveryProofUrls: a signing failure degrades to a clear proof_access_error, not a thrown exception", async () => {
  const storage = createFakeSupabaseStorage();
  storage.from = () => ({
    createSignedUrl() {
      return Promise.resolve({ data: null, error: { message: "not found" } });
    },
  });
  const results = await attachDeliveryProofUrls({ storage }, [{ id: 4, proof_photo_url: "shop-1/missing.jpg" }]);
  assert.equal(results[0].proof_signed_url, null);
  assert.equal(results[0].proof_access_error, "Proof photo unavailable.");
});

test("attachDeliveryProofUrls: processes multiple items independently, preserving order", async () => {
  const storage = createFakeSupabaseStorage();
  storage.from = () => ({
    createSignedUrl(path) {
      return Promise.resolve({ data: { signedUrl: `signed:${path}` }, error: null });
    },
  });
  const results = await attachDeliveryProofUrls({ storage }, [
    { id: 1, proof_photo_url: "shop-1/a.jpg" },
    { id: 2 },
    { id: 3, proof_photo_url: "shop-1/c.jpg" },
  ]);
  assert.deepEqual(results.map((r) => r.id), [1, 2, 3]);
  assert.equal(results[1].proof_signed_url, null);
});

test("validateProofCaptureBody: marking delivered without a photo requires a real reason", () => {
  const result = validateProofCaptureBody({ delivered_without_photo: true });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /Enter a reason/);
});

test("validateProofCaptureBody: delivered-without-photo with a real reason is valid", () => {
  const result = validateProofCaptureBody({ delivered_without_photo: true, no_photo_reason: "Left at front desk per customer" });
  assert.equal(result.valid, true);
  assert.equal(result.deliveredWithoutPhoto, true);
  assert.equal(result.noPhotoReason, "Left at front desk per customer");
});

test("validateProofCaptureBody: marking delivered requires a real photo unless explicitly skipped", () => {
  const result = validateProofCaptureBody({ mark_delivered: true });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /photo is required/);
});

test("validateProofCaptureBody: marking delivered with a real photo is valid", () => {
  const result = validateProofCaptureBody({ mark_delivered: true, proof_data_url: TINY_PNG_DATA_URL });
  assert.equal(result.valid, true);
});

test("validateProofCaptureBody: an excessively long reason is rejected", () => {
  const result = validateProofCaptureBody({ delivered_without_photo: true, no_photo_reason: "x".repeat(501) });
  assert.equal(result.valid, false);
  assert.match(result.errors.at(-1), /too long/);
});

test("validateProofCaptureBody: accepts the legacy without_photo_reason field name too", () => {
  const result = validateProofCaptureBody({ delivered_without_photo: true, without_photo_reason: "Signed by neighbor" });
  assert.equal(result.valid, true);
  assert.equal(result.noPhotoReason, "Signed by neighbor");
});
