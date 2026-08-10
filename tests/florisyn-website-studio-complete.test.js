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
import { setPropValue, schemaForSectionType } from "../lib/website-studio/section-props-schema.js";

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
