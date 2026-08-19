import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeDomain,
  buildDnsInstructions,
  mergeDomainStatus,
  verifyDomainDns
} from "../lib/website-studio/domain-verification.js";
import { buildWizardPayload, LILY_INTERVIEW_STEPS, styleToLaunchMode } from "../lib/website-studio/lily-interview.js";
import { setPropValue, getPropValue, schemaForSectionType } from "../lib/website-studio/section-props-schema.js";

test("normalizeDomain strips protocol and www", () => {
  assert.equal(normalizeDomain("https://WWW.Shop.COM/path"), "shop.com");
});

test("buildDnsInstructions returns CNAME steps", () => {
  const d = buildDnsInstructions("flowershop.com", { slug: "petals" }, { SITE_URL: "https://www.florisyn.com" });
  assert.equal(d.records[0].type, "CNAME");
  assert.ok(d.steps.length >= 3);
});

test("verifyDomainDns uses injectable resolver", async () => {
  const resolver = {
    resolveCname: async () => ["sites.florisyn.com"]
  };
  const r = await verifyDomainDns("shop.example.com", { FLORISYN_STORE_CNAME: "sites.florisyn.com" }, resolver);
  assert.equal(r.verified, true);
});

test("mergeDomainStatus marks connected when verified", () => {
  const s = mergeDomainStatus({}, { verified: true, records: ["x"] }, "shop.com");
  assert.equal(s.connected, true);
  assert.equal(s.status, "connected");
});

test("Lily interview builds wizard payload", () => {
  assert.ok(LILY_INTERVIEW_STEPS.length >= 6);
  const p = buildWizardPayload({ style: "Modern minimal", specialty: "Roses", launch_mode: "modern_minimal" });
  assert.equal(p.launch_mode, "modern_minimal");
  assert.ok(p.brief.specialty.includes("Roses"));
});

test("styleToLaunchMode maps florist personalities", () => {
  assert.equal(styleToLaunchMode("Wedding studio elegance"), "wedding_studio");
});

test("section props schema sets occasions array", () => {
  const s = setPropValue({ type: "occasion_tiles", props: {} }, "occasions", "Birthday, Sympathy, Wedding");
  assert.deepEqual(s.props.occasions, ["Birthday", "Sympathy", "Wedding"]);
});

test("hero schema has image field", () => {
  assert.ok(schemaForSectionType("hero").some((f) => f.path === "image"));
});

/**
 * WBX highest-value gap: the storefront renderer (lib/storefront/
 * section-renderer.js) has always supported testimonials, faq,
 * instagram, newsletter, map, announcement_bar, and seasonal_banner
 * sections, but a florist had no way to add or edit one — the editor's
 * "Add section" dropdown and this schema never covered them.
 */
test("every section type the storefront renderer supports now has a schema with a field matching its actual content", () => {
  const expectedField = {
    testimonials: "items",
    faq: "faqs",
    instagram: "handle",
    newsletter: "text",
    map: "address",
    announcement_bar: "text",
    seasonal_banner: "text"
  };
  for (const [type, path] of Object.entries(expectedField)) {
    const schema = schemaForSectionType(type);
    assert.ok(schema.some((f) => f.path === path), `${type} schema should include a "${path}" field`);
  }
});

test("testimonials quotes round-trip through setPropValue/getPropValue as Quote — Author lines", () => {
  const s = setPropValue(
    { type: "testimonials", props: {} },
    "items",
    "Beautiful arrangement, on time every time. — Jamie\nMy go-to florist for years. — Pat"
  );
  assert.deepEqual(s.props.items, [
    { quote: "Beautiful arrangement, on time every time.", author: "Jamie" },
    { quote: "My go-to florist for years.", author: "Pat" }
  ]);
  assert.equal(
    getPropValue(s, "items"),
    "Beautiful arrangement, on time every time. — Jamie\nMy go-to florist for years. — Pat"
  );
});

test("a quote with no ' — Author' separator keeps the whole line as the quote instead of being dropped", () => {
  const s = setPropValue({ type: "testimonials", props: {} }, "items", "Just lovely flowers.");
  assert.deepEqual(s.props.items, [{ quote: "Just lovely flowers.", author: "" }]);
});

test("faq pairs round-trip through setPropValue/getPropValue as Question | Answer lines", () => {
  const s = setPropValue(
    { type: "faq", props: {} },
    "faqs",
    "Do you deliver same day? | Yes, before noon in our delivery area.\nDo you take custom orders? | Yes, call the shop."
  );
  assert.deepEqual(s.props.faqs, [
    { q: "Do you deliver same day?", a: "Yes, before noon in our delivery area." },
    { q: "Do you take custom orders?", a: "Yes, call the shop." }
  ]);
  assert.equal(
    getPropValue(s, "faqs"),
    "Do you deliver same day? | Yes, before noon in our delivery area.\nDo you take custom orders? | Yes, call the shop."
  );
});

test("Editor's Add-section dropdown offers every section type the storefront renderer supports", () => {
  const editorHtml = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
  for (const type of ["testimonials", "faq", "instagram", "newsletter", "map", "announcement_bar", "seasonal_banner", "custom_text_image"]) {
    assert.match(editorHtml, new RegExp(`option value="${type}"`), `Add-section dropdown is missing "${type}"`);
  }
});

test("Lily wizard and inspector assets wired in index.html", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /lily-website-wizard\.js/);
  assert.match(html, /website-section-inspector\.js/);
});

test("instant-website exposes domain and lily actions", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
  assert.match(src, /verify_domain/);
  assert.match(src, /lily_wizard_generate/);
});
