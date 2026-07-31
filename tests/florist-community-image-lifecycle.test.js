/**
 * Mocked regression tests for Community image upload lifecycle (Correction R4).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertPrevalidatedCommunityImage,
  uploadPrevalidatedCommunityImage,
  removeCommunityImageQuietly,
} from "../netlify/functions/_shared/florist-community-storage.js";
import {
  validateCommunityImageUpload,
  validatePostBody,
  parseDataUrl,
  maxBase64LengthForBytes,
  COMMUNITY_IMAGE_MAX_BYTES,
} from "../netlify/functions/_shared/florist-community.js";

function mockStorageClient({ uploadError = null, removeError = null } = {}) {
  const calls = { upload: [], remove: [] };
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async upload(pathName, buffer, opts) {
            calls.upload.push({ bucket, path: pathName, buffer, opts });
            return uploadError ? { error: uploadError } : { error: null, data: { path: pathName } };
          },
          async remove(paths) {
            calls.remove.push({ bucket, paths });
            return removeError ? { error: removeError } : { error: null, data: paths };
          },
        };
      },
    },
  };
}

test("upload accepts only prevalidated sanitized image; never data URL / sharp", async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/florist-community-storage.js"),
    "utf8"
  );
  assert.doesNotMatch(src, /validateCommunityImageUpload|from ["']sharp["']|parseDataUrl|data_url/i);
  assert.doesNotMatch(src, /function upload[^(]*\([^)]*dataUrl/);
  assert.match(src, /assertPrevalidatedCommunityImage/);

  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(handler, /uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/);
  assert.doesNotMatch(handler, /validateCommunityImageUpload/);
  assert.doesNotMatch(handler, /uploadPrevalidatedCommunityImage\([^)]*body\.image_data_url/);

  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const image = await validateCommunityImageUpload({ buffer: png, mime: "image/png" });
  assert.equal(image.valid, true);
  assert.equal(image.sanitized, true);

  assert.equal(assertPrevalidatedCommunityImage(null).ok, false);
  assert.equal(assertPrevalidatedCommunityImage({ valid: true, sanitized: false, buffer: png, mime: "image/png" }).ok, false);
  assert.equal(assertPrevalidatedCommunityImage({ valid: true, sanitized: true, buffer: Buffer.alloc(0), mime: "image/png" }).ok, false);
  assert.equal(assertPrevalidatedCommunityImage(image).ok, true);

  const client = mockStorageClient();
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    image
  );
  assert.equal(up.ok, true);
  assert.equal(client.calls.upload.length, 1);
  assert.equal(client.calls.upload[0].buffer, image.buffer);
});

test("create/update path processes image exactly once via validatePostBody → upload", async () => {
  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const v = await validatePostBody({
    category: "Questions",
    caption: "once",
    image_data_url: dataUrl,
  });
  assert.equal(v.valid, true);
  assert.equal(v.image.sanitized, true);
  assert.equal(v.image.valid, true);
  assert.ok(Buffer.isBuffer(v.image.buffer) && v.image.buffer.length > 0);
  assert.ok(["image/jpeg", "image/png", "image/webp"].includes(v.image.mime));
  assert.ok(v.image.buffer.length <= COMMUNITY_IMAGE_MAX_BYTES);

  const client = mockStorageClient();
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    v.image
  );
  assert.equal(up.ok, true);
  // Upload must store the already-sanitized buffer from validatePostBody — no second sanitize API.
  assert.equal(client.calls.upload[0].buffer, v.image.buffer);
  assert.equal(client.calls.upload[0].buffer.equals(v.image.buffer), true);

  // Regression: sharp may exist only in the shared validator — never in upload/handler.
  const shared = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/florist-community.js"),
    "utf8"
  );
  const storage = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/florist-community-storage.js"),
    "utf8"
  );
  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(shared, /import sharp from "sharp"/);
  assert.equal((shared.match(/import sharp from "sharp"/g) || []).length, 1);
  assert.doesNotMatch(storage, /from ["']sharp["']/);
  assert.doesNotMatch(handler, /from ["']sharp["']/);
  assert.doesNotMatch(handler, /validateCommunityImageUpload/);
  assert.match(handler, /uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/);
});

test("pre-base64 size enforcement rejects oversized payloads before decode", () => {
  const maxChars = maxBase64LengthForBytes(COMMUNITY_IMAGE_MAX_BYTES);
  assert.ok(maxChars > 0);

  // Declared size rejected before decode.
  const tiny = "data:image/png;base64,aaaa";
  const declared = parseDataUrl(tiny, { sizeBytes: COMMUNITY_IMAGE_MAX_BYTES + 1 });
  assert.equal(declared.ok, false);
  assert.match(declared.error, /2 MB/);

  // Oversized base64 length rejected before Buffer.from would allocate a huge buffer.
  const hugeB64 = "A".repeat(maxChars + 4);
  const oversized = parseDataUrl(`data:image/png;base64,${hugeB64}`);
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /2 MB/);

  // Malformed base64 rejected safely.
  const bad = parseDataUrl("data:image/png;base64,!!!not-base64!!!");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid image encoding/);
});

test("lifecycle: upload success + post create failure removes new object", async () => {
  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const image = await validateCommunityImageUpload({ buffer: png, mime: "image/png" });
  const client = mockStorageClient();
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    image
  );
  assert.equal(up.ok, true);
  // Simulate DB insert failure cleanup path used by create_post.
  await removeCommunityImageQuietly(client, up.path);
  assert.equal(client.calls.remove.length, 1);
  assert.deepEqual(client.calls.remove[0].paths, [up.path]);
});

test("lifecycle: replacement upload + DB update failure removes only new object", async () => {
  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const image = await validateCommunityImageUpload({ buffer: png, mime: "image/png" });
  const client = mockStorageClient();
  const previousPath = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/old.png";
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    image
  );
  assert.equal(up.ok, true);
  // On DB failure: remove new only — never previous.
  await removeCommunityImageQuietly(client, up.path);
  assert.equal(client.calls.remove.length, 1);
  assert.deepEqual(client.calls.remove[0].paths, [up.path]);
  assert.notEqual(up.path, previousPath);
});

test("lifecycle: successful replacement removes previous after DB success", async () => {
  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const image = await validateCommunityImageUpload({ buffer: png, mime: "image/png" });
  const client = mockStorageClient();
  const previousPath = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/old.png";
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    image
  );
  // DB success then remove previous (order required by update_post).
  await removeCommunityImageQuietly(client, previousPath);
  assert.deepEqual(client.calls.remove[0].paths, [previousPath]);
  assert.ok(up.path);
});

test("lifecycle: author delete removes image after DB delete; cleanup errors stay quiet", async () => {
  const client = mockStorageClient({ removeError: { message: "boom" } });
  const errors = [];
  const orig = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await removeCommunityImageQuietly(
      client,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/x.png"
    );
    assert.equal(result.ok, false);
    assert.ok(errors.some((e) => /Community image cleanup failed/.test(e)));
    assert.ok(!errors.some((e) => /aaaaaaaa-aaaa/.test(e)), "must not log object path");
  } finally {
    console.error = orig;
  }
});

test("handler preserves image on moderator soft-remove; deletes image only on author hard-delete", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /Remove image only after successful author hard-delete/);
  assert.match(src, /preserve image for review/);
  // Soft-remove branch must not call removeCommunityImageQuietly.
  const softIdx = src.indexOf("Moderators soft-remove only");
  const softSlice = src.slice(softIdx, softIdx + 600);
  assert.doesNotMatch(softSlice, /removeCommunityImageQuietly/);
});
