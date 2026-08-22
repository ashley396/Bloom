import test from "node:test";
import assert from "node:assert/strict";
import { FLYER_TEMPLATES, ASPECT_RATIOS, pickFlyerTemplate, pickAspectRatio } from "../netlify/functions/_shared/flyer-templates.js";

test("every template defines every region a renderer needs (headline/body/cta/logo/contact)", () => {
  for (const template of Object.values(FLYER_TEMPLATES)) {
    for (const region of ["headline", "body", "cta", "logo", "contact"]) {
      assert.ok(template.regions[region], `${template.id} is missing region: ${region}`);
    }
  }
});

test("pickFlyerTemplate: a closing/hours message picks the notice template — maximum-legibility layout", () => {
  const template = pickFlyerTemplate({ occasion: "closing early" });
  assert.equal(template.id, "notice");
});

test("pickFlyerTemplate: a Mother's Day request picks the holiday template", () => {
  const template = pickFlyerTemplate({ occasion: "Mother's Day" });
  assert.equal(template.id, "holiday");
});

test("pickFlyerTemplate: no occasion or an unrecognized one falls back to general — never throws, never returns nothing", () => {
  assert.equal(pickFlyerTemplate({}).id, "general");
  assert.equal(pickFlyerTemplate({ occasion: "something totally unrelated" }).id, "general");
  assert.equal(pickFlyerTemplate().id, "general");
});

test("pickAspectRatio maps loose platform language to a real, defined size", () => {
  assert.equal(pickAspectRatio("Instagram Story"), "story");
  assert.equal(pickAspectRatio("facebook post"), "facebook_post");
  assert.equal(pickAspectRatio("printable flyer"), "flyer");
  assert.equal(pickAspectRatio("email header"), "email_banner");
  assert.equal(pickAspectRatio(null), "square");
  assert.equal(pickAspectRatio("something unrecognized"), "square");
});

test("every ASPECT_RATIOS entry pickAspectRatio can return has real, positive dimensions", () => {
  for (const size of Object.values(ASPECT_RATIOS)) {
    assert.ok(size.width > 0);
    assert.ok(size.height > 0);
  }
});
