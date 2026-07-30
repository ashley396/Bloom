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
    "docs/FLORISYN_GOVERNANCE_MAP.md",
    "docs/FLORISYN_EXPERIENCE_STANDARD.md",
    "docs/FLORISYN_DESIGN_SYSTEM.md",
    "docs/FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md",
    "docs/FLORISYN_PORTAL_OWNERSHIP_MATRIX.md",
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

test("ecosystem portals standard defines three portals and shared platform rules", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md"),
    "utf8",
  );
  for (const portal of [
    "Portal 1 — Florist",
    "Portal 2 — Wholesaler",
    "Portal 3 — Platform Owner",
  ]) {
    assert.match(doc, new RegExp(portal), `missing portal: ${portal}`);
  }
  assert.match(doc, /Which portal uses it/);
  assert.match(doc, /single source of truth/i);
  assert.match(doc, /Gold Standard and Experience Standard/);
  for (const shared of [
    "Customer model",
    "Product model",
    "Inventory model",
    "Order model",
    "Payment model",
    "Delivery model",
  ]) {
    assert.match(doc, new RegExp(shared), `missing shared service: ${shared}`);
  }
});

test("design system v1 defines tokens components and review checklist", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_DESIGN_SYSTEM.md"),
    "utf8",
  );
  assert.match(doc, /Design System v1\.0/);
  assert.match(doc, /Colors communicate meaning before decoration/);
  assert.match(doc, /4 • 8 • 12 • 16 • 24 • 32 • 48 • 64 px/);
  assert.match(doc, /150ms/);
  assert.match(doc, /not spreadsheet rows/i);
  assert.match(doc, /Design review checklist/);
  assert.match(doc, /design tokens/i);
  for (const component of [
    "Buttons",
    "Cards",
    "Order Cards",
    "Status Badges",
    "Empty States",
    "Loading Skeletons",
  ]) {
    assert.match(doc, new RegExp(component), `missing component: ${component}`);
  }
});

test("governance map defines documentation hierarchy and entry points", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_GOVERNANCE_MAP.md"),
    "utf8",
  );
  assert.match(doc, /Which document should I use/);
  assert.match(doc, /FLORISYN_MASTER_ARCHITECTURE_BIBLE\.md/);
  assert.match(doc, /FLORISYN_GOLD_STANDARD\.md/);
  assert.match(doc, /FLORISYN_EXPERIENCE_STANDARD\.md/);
  assert.match(doc, /FLORISYN_DESIGN_SYSTEM\.md/);
  assert.match(doc, /FLORISYN_ECOSYSTEM_PORTALS_STANDARD\.md/);
  assert.match(doc, /FLORISYN_WEBSITE_STUDIO_BLUEPRINT\.md/);
  assert.match(doc, /FLORISYN_MASTER_BUILD_CHECKLIST\.md/);
  assert.match(doc, /No implementation should contradict a higher-level document/);
  const bible = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md"),
    "utf8",
  );
  assert.match(bible, /## 0\. Governance map/);
  assert.match(bible, /FLORISYN_GOVERNANCE_MAP\.md/);
});

test("portal ownership matrix defines shared service roles per portal", () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_PORTAL_OWNERSHIP_MATRIX.md"),
    "utf8",
  );
  assert.match(doc, /Single Source of Truth/i);
  for (const service of [
    "Customers",
    "Products",
    "Inventory",
    "Orders",
    "Payments",
    "Delivery",
    "Website Studio",
    "Marketplace",
    "Security",
  ]) {
    assert.match(doc, new RegExp(service), `missing service: ${service}`);
  }
  assert.match(doc, /Florist Portal/);
  assert.match(doc, /Wholesaler Portal/);
  assert.match(doc, /Platform Owner Portal/);
  assert.match(doc, /one canonical data model/i);
});
