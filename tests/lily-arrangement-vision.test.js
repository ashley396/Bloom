import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateDeliveryProofUpload, parseDataUrl } from "../netlify/functions/_shared/upload-validation.js";

test("arrangement vision handler requires auth path and validates uploads", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/lily-arrangement-vision.js"), "utf8");
  assert.match(src, /currentUser/);
  assert.match(src, /validateDeliveryProofUpload/);
  assert.match(src, /requires_approval:\s*true/);
  assert.match(src, /manual_fallback/);
  assert.equal(/openai/i.test(src), false);
});

test("upload validation rejects oversize and bad mime", () => {
  const tiny = Buffer.alloc(100).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${tiny}`;
  assert.equal(validateDeliveryProofUpload({ dataUrl }).valid, true);
  assert.equal(validateDeliveryProofUpload({ mime: "application/pdf", sizeBytes: 100 }).valid, false);
  const huge = Buffer.alloc(6 * 1024 * 1024).toString("base64");
  assert.equal(validateDeliveryProofUpload({ dataUrl: `data:image/jpeg;base64,${huge}` }).valid, false);
});

test("parseDataUrl decodes jpeg payload", () => {
  const buf = Buffer.from("abc");
  const parsed = parseDataUrl(`data:image/jpeg;base64,${buf.toString("base64")}`);
  assert.equal(parsed.mime, "image/jpeg");
  assert.equal(parsed.buffer.toString(), "abc");
});

test("lily platform exposes photo analyze control", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/lily-platform.js"), "utf8");
  assert.match(src, /lily-arrangement-vision/);
  assert.match(src, /analyzeArrangementPhoto/);
  assert.match(src, /nothing was saved automatically/i);
});
