import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("delivery-proofs storage migration defines private bucket and shop RLS", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260730_delivery_proofs_storage.sql"),
    "utf8",
  );
  assert.match(sql, /delivery-proofs/);
  assert.match(sql, /public\s*=\s*false|false,\s*\n\s*5242880/);
  assert.match(sql, /image\/jpeg/);
  assert.match(sql, /image\/heic/);
  assert.match(sql, /is_shop_member/);
  assert.match(sql, /delivery proofs shop member select/);
});

test("delivery-proofs rollback removes bucket and policies", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/rollback/20260730_delivery_proofs_storage_rollback.sql"),
    "utf8",
  );
  assert.match(sql, /drop policy if exists "delivery proofs shop member select"/);
  assert.match(sql, /delete from storage.buckets where id = 'delivery-proofs'/);
});

test("stacked release documentation package exists", () => {
  for (const file of [
    "docs/STACKED_RELEASE_READINESS_REPORT.md",
    "docs/STACKED_RELEASE_OWNER_CHECKLIST.md",
    "docs/STACKED_RELEASE_SMOKE_TEST.md",
    "docs/STACKED_RELEASE_ROLLBACK.md",
    "docs/FLORISYN_GOLD_STANDARD.md",
    "docs/FLORISYN_EXPERIENCE_STANDARD.md",
  ]) {
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `${file} missing`);
  }
});

test("gold standard defines ten permanent product principles", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_GOLD_STANDARD.md"),
    "utf8",
  );
  for (const principle of [
    "Single Source of Truth",
    "Florist First",
    "Calm Software",
    "Explainable AI",
    "One Click Rule",
    "Recovery Before Speed",
    "Holiday Mode",
    "Delight",
    "Performance Budget",
    "Future Ecosystem",
  ]) {
    assert.match(doc, new RegExp(principle), `missing principle: ${principle}`);
  }
  assert.match(doc, /Accept \/ Edit \/ Reject/);
  assert.match(doc, /Under 2 seconds/);
});

test("experience standard defines UX constitution and completion gate", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_EXPERIENCE_STANDARD.md"),
    "utf8",
  );
  assert.match(doc, /Beauty never slows the florist down/);
  assert.match(doc, /Orders Standard/i);
  assert.match(doc, /Never resemble a spreadsheet/);
  assert.match(doc, /Florist Emotion Standard/i);
  assert.match(doc, /Would a florist enjoy using it for an entire workday/);
  for (const section of [
    "Typography",
    "Color",
    "Cards",
    "Buttons",
    "Motion",
    "Empty states",
    "Accessibility",
  ]) {
    assert.match(doc, new RegExp(section), `missing section: ${section}`);
  }
});
