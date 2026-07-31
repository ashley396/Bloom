/**
 * Mocked regression tests for Community image upload lifecycle (Correction R4/R5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertPrevalidatedCommunityImage,
  uploadPrevalidatedCommunityImage,
  removeCommunityImageQuietly,
  reconcileCommunityImageAfterWriteError,
} from "../netlify/functions/_shared/florist-community-storage.js";
import {
  validateCommunityImageUpload,
  validatePostBody,
  parseDataUrl,
  maxBase64LengthForBytes,
  COMMUNITY_IMAGE_MAX_BYTES,
} from "../netlify/functions/_shared/florist-community.js";

const SAMPLE_PATH =
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/x.png";

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

/**
 * Supabase-shaped client for reconciliation: posts query + storage remove.
 */
function mockReconcileClient({
  rows = [],
  queryError = null,
  queryThrow = null,
  removeError = null,
} = {}) {
  const calls = { select: [], remove: [] };
  return {
    calls,
    from(table) {
      assert.equal(table, "florist_community_posts");
      const state = { filters: {} };
      const builder = {
        select(cols) {
          state.select = cols;
          return builder;
        },
        eq(col, val) {
          state.filters[col] = val;
          return builder;
        },
        limit(n) {
          state.limit = n;
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(async () => {
              calls.select.push({ ...state });
              if (queryThrow) throw queryThrow;
              if (queryError) return { data: null, error: queryError };
              return { data: rows, error: null };
            })
            .then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        return {
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
  assert.match(src, /reconcileCommunityImageAfterWriteError/);

  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(handler, /uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/);
  assert.match(handler, /reconcileCommunityImageAfterWriteError\(client, uploadedPath\)/);
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
  assert.equal(client.calls.upload[0].buffer, v.image.buffer);
  assert.equal(client.calls.upload[0].buffer.equals(v.image.buffer), true);

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
  assert.equal(
    (handler.match(/reconcileCommunityImageAfterWriteError\(client, uploadedPath\)/g) || []).length,
    2
  );
});

test("pre-base64 size enforcement rejects oversized payloads before decode", () => {
  const maxChars = maxBase64LengthForBytes(COMMUNITY_IMAGE_MAX_BYTES);
  assert.ok(maxChars > 0);

  const tiny = "data:image/png;base64,aaaa";
  const declared = parseDataUrl(tiny, { sizeBytes: COMMUNITY_IMAGE_MAX_BYTES + 1 });
  assert.equal(declared.ok, false);
  assert.match(declared.error, /2 MB/);

  const hugeB64 = "A".repeat(maxChars + 4);
  const oversized = parseDataUrl(`data:image/png;base64,${hugeB64}`);
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /2 MB/);

  const bad = parseDataUrl("data:image/png;base64,!!!not-base64!!!");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid image encoding/);
});

test("R5 reconcile: write error + post references new image → retain; remove 0", async () => {
  const client = mockReconcileClient({
    rows: [{ id: "post-1" }],
  });
  const result = await reconcileCommunityImageAfterWriteError(client, SAMPLE_PATH);
  assert.equal(result.action, "retained");
  assert.equal(result.reason, "referenced");
  assert.equal(client.calls.remove.length, 0);
  assert.equal(client.calls.select.length, 1);
  assert.equal(client.calls.select[0].filters.image_path, SAMPLE_PATH);
});

test("R5 reconcile: write error + DB confirms no reference → remove exactly once", async () => {
  const client = mockReconcileClient({ rows: [] });
  const result = await reconcileCommunityImageAfterWriteError(client, SAMPLE_PATH);
  assert.equal(result.action, "removed");
  assert.equal(result.reason, "orphan");
  assert.equal(client.calls.remove.length, 1);
  assert.deepEqual(client.calls.remove[0].paths, [SAMPLE_PATH]);
});

test("R5 reconcile: query returns error → retain; remove 0", async () => {
  const client = mockReconcileClient({
    queryError: {
      code: "PGRST301",
      message: `secret token=abc123 path=${SAMPLE_PATH} https://evil.example/x`,
    },
  });
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const result = await reconcileCommunityImageAfterWriteError(client, SAMPLE_PATH);
    assert.equal(result.action, "retained");
    assert.equal(result.reason, "query_error");
    assert.equal(client.calls.remove.length, 0);
  } finally {
    console.error = orig;
  }
  assert.ok(logs.some((args) => args[0] === "community_image_reconcile_deferred"));
});

test("R5 reconcile: query throws → retain; remove 0", async () => {
  const client = mockReconcileClient({
    queryThrow: new Error(`boom path=${SAMPLE_PATH} token=leak https://x`),
  });
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const result = await reconcileCommunityImageAfterWriteError(client, SAMPLE_PATH);
    assert.equal(result.action, "retained");
    assert.equal(result.reason, "query_throw");
    assert.equal(client.calls.remove.length, 0);
  } finally {
    console.error = orig;
  }
  assert.ok(logs.some((args) => args[0] === "community_image_reconcile_deferred"));
});

test("R5 reconcile logging never exposes path, token, URL, or raw error message", async () => {
  const injectedPath = SAMPLE_PATH;
  const injectedToken = "tok_LIVE_secret_should_not_log";
  const injectedUrl = "https://signed.example/object?token=xyz";
  const rawMessage = `db failed path=${injectedPath} token=${injectedToken} url=${injectedUrl}`;

  const cases = [
    () =>
      reconcileCommunityImageAfterWriteError(
        mockReconcileClient({ queryError: { code: "XX000", message: rawMessage } }),
        injectedPath
      ),
    () =>
      reconcileCommunityImageAfterWriteError(
        mockReconcileClient({ queryThrow: new Error(rawMessage) }),
        injectedPath
      ),
    async () => {
      const client = mockReconcileClient({
        rows: [],
        removeError: { code: "StorageError", message: rawMessage },
      });
      return removeCommunityImageQuietly(client, injectedPath);
    },
  ];

  for (const run of cases) {
    const logs = [];
    const orig = console.error;
    console.error = (...args) => logs.push(args.map(String).join(" "));
    try {
      await run();
    } finally {
      console.error = orig;
    }
    const joined = logs.join("\n");
    assert.ok(!joined.includes(injectedPath), "must not log object path");
    assert.ok(!joined.includes(injectedToken), "must not log token");
    assert.ok(!joined.includes(injectedUrl), "must not log signed URL");
    assert.ok(!joined.includes(rawMessage), "must not log raw provider message");
    assert.ok(!joined.includes("https://"), "must not log URLs");
    for (const line of logs) {
      assert.match(line, /community_image_(reconcile_deferred|cleanup_failed)/);
    }
  }
});

test("lifecycle: successful replacement removes previous after DB success; new retained", async () => {
  const png = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/community-images/valid-1x1.png"));
  const image = await validateCommunityImageUpload({ buffer: png, mime: "image/png" });
  const client = mockStorageClient();
  const previousPath =
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/old.png";
  const up = await uploadPrevalidatedCommunityImage(
    client,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
    image
  );
  assert.equal(up.ok, true);
  // DB update succeeds first, then previous is removed (handler order).
  await removeCommunityImageQuietly(client, previousPath);
  assert.equal(client.calls.remove.length, 1);
  assert.deepEqual(client.calls.remove[0].paths, [previousPath]);
  assert.notEqual(up.path, previousPath);
  // New image path was never removed.
  assert.ok(!client.calls.remove.some((c) => c.paths.includes(up.path)));
});

test("handler: create/update use reconcile on write error; success path removes previous only", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /reconcileCommunityImageAfterWriteError\(client, uploadedPath\)/);
  assert.equal(
    (src.match(/reconcileCommunityImageAfterWriteError\(client, uploadedPath\)/g) || []).length,
    2
  );

  // Success path still removes previous after DB success.
  assert.match(
    src,
    /if \(uploadedPath && previousPath && previousPath !== uploadedPath\) \{\s*await removeCommunityImageQuietly\(client, previousPath\);/s
  );

  // Author hard-delete still removes after DB delete.
  assert.match(src, /Remove image only after successful author hard-delete/);
  const hardIdx = src.indexOf("Remove image only after successful author hard-delete");
  assert.match(src.slice(hardIdx, hardIdx + 200), /removeCommunityImageQuietly/);

  // Soft-remove preserves image.
  assert.match(src, /preserve image for review/);
  const softIdx = src.indexOf("Moderators soft-remove only");
  const softSlice = src.slice(softIdx, softIdx + 600);
  assert.doesNotMatch(softSlice, /removeCommunityImageQuietly/);
  assert.doesNotMatch(softSlice, /reconcileCommunityImageAfterWriteError/);
});

test("lifecycle: author delete removes image after DB delete; cleanup errors stay redacted", async () => {
  const client = mockStorageClient({
    removeError: {
      code: "StorageError",
      message: `boom path=${SAMPLE_PATH} token=secret https://evil.example`,
    },
  });
  const errors = [];
  const orig = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const result = await removeCommunityImageQuietly(client, SAMPLE_PATH);
    assert.equal(result.ok, false);
    assert.ok(errors.some((e) => /community_image_cleanup_failed/.test(e)));
    assert.ok(!errors.some((e) => e.includes(SAMPLE_PATH)), "must not log object path");
    assert.ok(!errors.some((e) => /token=secret|https:\/\//.test(e)), "must not log secrets/URLs");
  } finally {
    console.error = orig;
  }
});

test("handler preserves image on moderator soft-remove; deletes image only on author hard-delete", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /Remove image only after successful author hard-delete/);
  assert.match(src, /preserve image for review/);
  const softIdx = src.indexOf("Moderators soft-remove only");
  const softSlice = src.slice(softIdx, softIdx + 600);
  assert.doesNotMatch(softSlice, /removeCommunityImageQuietly/);
});
