import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const governance = fs.readFileSync(
  new URL("../docs/architecture/FLORISYN-BLUEPRINT-GOVERNANCE-MAP.md", import.meta.url),
  "utf8"
);
const instantWebsiteHandler = fs.readFileSync(
  new URL("../netlify/functions/instant-website.js", import.meta.url),
  "utf8"
);
const storefrontCore = fs.readFileSync(
  new URL("../netlify/functions/_shared/bloom-storefront-core.js", import.meta.url),
  "utf8"
);
const storefrontPublic = fs.readFileSync(
  new URL("../netlify/functions/storefront-public.js", import.meta.url),
  "utf8"
);
const customerFacingBrandSurfaces = [
  "../netlify/functions/production-health.js",
  "../netlify/functions/health.js",
  "../netlify/functions/lily-ai.js",
  "../netlify/functions/ai-assistant.js",
  "../netlify/functions/payment-link-public.js",
  "../netlify/functions/floral-library.js",
  "../netlify/functions/_shared/bloom-instant-website.js",
  "../netlify/functions/_shared/lily-ai-engine.js",
  "../netlify/functions/_shared/payment-hub-experience.js",
  "../netlify/functions/_shared/payment-hub-providers.js",
  "../netlify/functions/_shared/post-stripe-payment.js",
  "../netlify/functions/_shared/floral-library-core.js",
  "../public/assets/daisy/daisy-resting.svg",
].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("blueprint governance records the complete source set and authority order", () => {
  assert.match(governance, /Master Architecture & Development Bible v1\.0/);
  assert.match(governance, /Florisyn Master Feature Blueprint/);
  assert.match(governance, /Florisyn Owner\/Admin Blueprint/);
  assert.match(governance, /Florisyn Wholesalers Page Blueprint/);
  assert.match(governance, /53cf2a6e3485cd0dff4649ce551160d017e6f421e60bcbbc4738a0adb4bc6499/);
  assert.match(governance, /d0e7c6aae7cac81984d5757f0e459f2c84ba7f62159157c6843a7bbd7b149367/);
  assert.match(governance, /253d487e23edaf8d7b45d36db16006c580f8bfd73014fa51d14dbfdfc1b329ea/);
  assert.match(governance, /91ee20e73b1cc53f4166eb6e9844b376ac9b7e4c48ed1410734a86733ec842f1/);
  assert.ok(governance.indexOf("Master product and phase authority") < governance.indexOf("Owner/Admin module requirements"));
});

test("August 21 launch scope includes the required florist, admin, website, and character wedge", () => {
  assert.match(governance, /August 21, 2026/);
  assert.match(governance, /Today preserved as the daily operating home/);
  assert.match(governance, /essential Owner\/Admin operations/);
  assert.match(governance, /mobile-responsive florist website builder/);
  assert.match(governance, /\*\*Lily\*\*, \*\*Rose\*\*, and \*\*Daisy\*\*/);
  assert.match(governance, /core florist workflows remaining available when AI or optional services are offline/);
  assert.match(governance, /Wholesalers\/Marketplace, advanced drag-anywhere editing/);
});

test("website drafts and publishing require confirmed Supabase writes", () => {
  const api = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
  const editor = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
  assert.match(api, /if \(pageError\) throw pageError/);
  assert.match(api, /if \(versionError\) throw versionError/);
  assert.match(api, /if \(saveError\) throw saveError/);
  assert.match(api, /website_page_saved/);
  assert.match(editor, /if \(!saved\?\.saved \|\| !saved\?\.page\?\.id\)/);
  assert.match(editor, /if \(!published\?\.published \|\| published\?\.status !== "published"\)/);
});

test("storefront bundle reads pages for the selected project only", () => {
  assert.match(
    storefrontPublic,
    /\.from\("bloom_website_pages"\)\s*\.select\("\*"\)\s*\.eq\("shop_id", shopId\)\s*\.eq\("project_id", project\.id\)/s
  );
  assert.doesNotMatch(
    storefrontPublic,
    /\.from\("bloom_website_pages"\)\s*\.select\("\*"\)\s*\.eq\("shop_id", shopId\)\s*\.order\("nav_order"/s
  );
});

test("editor preserves unsaved sections on save and publish failure", () => {
  const editor = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
  assert.match(editor, /Your changes remain in the editor/);
  assert.match(editor, /Publishing was stopped/);
  assert.match(editor, /Your saved draft is safe/);
  assert.doesNotMatch(editor, /catch\s*\([^)]*\)\s*{[^}]*sections\s*=\s*\[\]/s);
});

test("publish requires save confirmation before publish call", () => {
  const editor = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
  assert.ok(editor.indexOf('api("save_page"') < editor.indexOf('api("publish"'));
  assert.match(editor, /if \(!saved\?\.saved \|\| !saved\?\.page\?\.id\) throw/);
});

test("Today and the daily florist loop remain protected", () => {
  assert.match(governance, /\*\*Today is PRESERVE\.\*\*/);
  assert.match(
    governance,
    /customer contact → order → payment → recipe\/production → inventory → delivery\/pickup → receipt\/invoice → reporting/
  );
  assert.match(governance, /No feature may weaken tenant isolation, RLS, payment integrity, auditability, rollback, or florist control/);
});

test("every implementation uses the required five-way classification", () => {
  for (const classification of ["PRESERVE", "COMPLETE", "FOUNDATION", "ARCHITECT", "FUTURE"]) {
    assert.match(governance, new RegExp(`\\*\\*${classification}\\*\\*`));
  }
});

test("Owner editing and Wholesalers cannot bypass the master phase order", () => {
  assert.match(governance, /Advanced experience editing is ARCHITECT/);
  assert.match(governance, /Wholesalers blueprint is accepted as the detailed Phase 6 target/);
  assert.match(governance, /No current release artifact may describe Wholesalers as live, complete, or generally available/);
  assert.match(governance, /internal phases, but those phases operate inside—not ahead of—the Master Bible phase/);
});

test("governance preserves hosted-write and production approval boundaries", () => {
  assert.match(governance, /Production database changes, production deployment, production load testing/);
  assert.match(governance, /Uploading the current working tree to a hosted build service transmits uncommitted repository source/);
  assert.match(governance, /Production secrets must never be substituted/);
});

test("website publishing confirms persistence and creates an audit event", () => {
  assert.match(instantWebsiteHandler, /\.select\("id,status"\)/);
  assert.match(instantWebsiteHandler, /if \(error\) throw error/);
  assert.match(instantWebsiteHandler, /Create and save a website draft before publishing/);
  assert.match(instantWebsiteHandler, /Website publish could not be confirmed/);
  assert.match(instantWebsiteHandler, /eventType: "website_published"/);
  assert.match(instantWebsiteHandler, /entityId: project\.id/);
});

test("website generation is low-cost and settings never claim an unconfirmed save", () => {
  assert.match(instantWebsiteHandler, /\.insert\(rows\)/);
  assert.match(instantWebsiteHandler, /\.upsert\(pageRows, \{ onConflict: "project_id,slug" \}\)/);
  assert.doesNotMatch(instantWebsiteHandler, /for \(const page of site\.pages\)/);
  assert.match(instantWebsiteHandler, /Create a website draft before changing its theme/);
  assert.match(instantWebsiteHandler, /Theme change could not be confirmed/);
  assert.match(instantWebsiteHandler, /Create a website draft before changing commerce settings/);
  assert.doesNotMatch(instantWebsiteHandler, /data\?\.commerce_settings \|\| settings/);
});

test("public storefront previews fail closed and database read failures stay visible", () => {
  assert.match(storefrontCore, /BLOOM_STOREFRONT_PREVIEW_SECRET \|\| env\.PAYMENT_HUB_TOKEN_KEY \|\| null/);
  assert.doesNotMatch(storefrontCore, /bloom-preview-dev-only/);
  assert.match(storefrontCore, /if \(!secret\) throw new Error\("Storefront preview is not configured\."\)/);
  assert.match(storefrontCore, /crypto\.timingSafeEqual/);
  assert.match(storefrontPublic, /if \(projectError\) throw projectError/);
  assert.match(storefrontPublic, /if \(pagesError\) throw pagesError/);
  assert.match(storefrontPublic, /\.eq\("project_id", project\.id\)/);
});

test("customer-facing system identity is Florisyn while legacy internals remain compatible", () => {
  assert.match(customerFacingBrandSurfaces, /Florisyn Production Readiness/);
  assert.match(customerFacingBrandSurfaces, /your Florisyn role/);
  assert.match(customerFacingBrandSurfaces, /Florisyn's florist business assistant/);
  assert.match(customerFacingBrandSurfaces, /Daisy, Florisyn mascot/);
  assert.doesNotMatch(customerFacingBrandSurfaces, /Bloom Production Readiness|Bloom Commercial v4/);
  assert.doesNotMatch(customerFacingBrandSurfaces, /your Bloom role|guide Bloom|Bloom should take action/);
  assert.doesNotMatch(customerFacingBrandSurfaces, /Bloom florist|Bloom RC2 starter catalog|Daisy, Bloom mascot/);
  assert.doesNotMatch(customerFacingBrandSurfaces, /sent to Bloom|Bloom stores provider|Bloom order metadata|Bloom starter asset/);
});

test("legacy shop settings cannot bypass verified website publishing", () => {
  const settingsHandler = fs.readFileSync(new URL("../netlify/functions/settings.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(settingsHandler, /if\("website_published" in body\)return json\(409/);
  assert.match(settingsHandler, /Use Website Studio’s verified publish workflow/);
  assert.doesNotMatch(app, /d\.website_published=/);
  assert.doesNotMatch(page, /name="website_published"/);
});
