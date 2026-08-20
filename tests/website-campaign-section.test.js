import test from "node:test";
import assert from "node:assert/strict";
import { applyGeneratedWebsiteSection, buildWebsiteSectionPayload } from "../netlify/functions/_shared/website-campaign-section.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const SECTION = { type: "hero", props: { title: "Homecoming", subtitle: "", text: "", cta: "Order now", image: "https://fake.storage/x.jpg" } };

test("buildWebsiteSectionPayload: maps creative-engine content onto the existing hero section schema, never inventing a new section type", () => {
  const payload = buildWebsiteSectionPayload(
    { headline: "Homecoming orders are open", subheadline: "Don't miss the dance", body: "Order today.", cta_label: "Order now" },
    { imageUrl: "https://fake.storage/img.jpg" }
  );
  assert.equal(payload.type, "hero");
  assert.equal(payload.props.title, "Homecoming orders are open");
  assert.equal(payload.props.subtitle, "Don't miss the dance");
  assert.equal(payload.props.text, "Order today.");
  assert.equal(payload.props.cta, "Order now");
  assert.equal(payload.props.image, "https://fake.storage/img.jpg");
});

test("buildWebsiteSectionPayload: missing fields degrade to empty strings/null, never 'undefined' text or a thrown error", () => {
  const payload = buildWebsiteSectionPayload({});
  assert.equal(payload.props.title, "");
  assert.equal(payload.props.subtitle, "");
  assert.equal(payload.props.text, "");
  assert.equal(payload.props.cta, "");
  assert.equal(payload.props.image, null);
});

test("applyGeneratedWebsiteSection: no Website Builder X draft yet — reports applied:false with a real reason, not an error", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null } // bloom_website_projects select — nothing found
  ]);
  const result = await applyGeneratedWebsiteSection(client, { shopId: "shop-1", userId: "user-1", section: SECTION });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.match(result.reason, /hasn't started a Website Builder X draft/i);
  // Never wrote anything when there's nothing to write to.
  assert.ok(!client.calls.some((c) => c.table === "bloom_website_pages"));
});

test("applyGeneratedWebsiteSection: a project exists but has no home page yet — reports applied:false, still not an error", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "project-1" }, error: null }, // project select
    { data: null, error: null } // page select — no home page
  ]);
  const result = await applyGeneratedWebsiteSection(client, { shopId: "shop-1", userId: "user-1", section: SECTION });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.match(result.reason, /no home page/i);
});

test("applyGeneratedWebsiteSection: a real project select failure surfaces as ok:false, not swallowed", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: { message: "connection reset" } }
  ]);
  const result = await applyGeneratedWebsiteSection(client, { shopId: "shop-1", userId: "user-1", section: SECTION });
  assert.equal(result.ok, false);
  assert.match(result.error, /connection reset/);
});

test("applyGeneratedWebsiteSection: a version-snapshot failure aborts before touching the live draft — the undo safety net is not optional", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "project-1" }, error: null },
    { data: { id: "page-1", sections: [], content: {} }, error: null },
    { data: null, error: { message: "version insert failed" } } // version snapshot fails
  ]);
  const result = await applyGeneratedWebsiteSection(client, { shopId: "shop-1", userId: "user-1", section: SECTION });
  assert.equal(result.ok, false);
  assert.match(result.error, /version insert failed/);
  // Never reached the page update — the draft is untouched.
  assert.ok(!client.calls.some((c) => c.table === "bloom_website_pages" && c.ops.some(([op]) => op === "update")));
});

test("applyGeneratedWebsiteSection: a successful apply appends the section (never replaces existing ones) and snapshots first for undo", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "project-1" }, error: null },
    { data: { id: "page-1", sections: [{ id: "hero-existing", type: "hero", order: 0, props: { title: "Welcome" } }], content: { some: "thing" } }, error: null },
    { data: { id: "version-1" }, error: null },
    { data: { id: "page-1", slug: "home", updated_at: "2026-08-20T00:00:00Z" }, error: null },
    { data: null, error: null } // audit_events insert
  ]);
  const result = await applyGeneratedWebsiteSection(client, { shopId: "shop-1", userId: "user-1", section: SECTION });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.page.id, "page-1");

  const versionInsert = client.calls.find((c) => c.table === "bloom_website_page_versions");
  assert.deepEqual(versionInsert.payload.snapshot, { content: { some: "thing" }, sections: [{ id: "hero-existing", type: "hero", order: 0, props: { title: "Welcome" } }] });

  const pageUpdate = client.calls.find((c) => c.table === "bloom_website_pages" && c.ops.some(([op]) => op === "update"));
  assert.equal(pageUpdate.payload.sections.length, 2);
  assert.equal(pageUpdate.payload.sections[0].id, "hero-existing");
  assert.equal(pageUpdate.payload.sections[1].type, "hero");
  assert.equal(pageUpdate.payload.sections[1].props.title, "Homecoming");
});
