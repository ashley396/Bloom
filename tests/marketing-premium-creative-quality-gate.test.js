import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalConcept } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { buildDeterministicCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";

// Batch 6 ("Premium Creative quality architecture"), Part 7 — campaign-
// fidelity quality-gate tests.
//
// The point Ashley made in the read-only audit that preceded this batch:
// a generation is NOT successful merely because a job completed / an
// image exists / privacy tests passed. For a real campaign request, the
// actual marketing objective must survive, structurally, into the
// finished creative specification. These tests never assert one exact
// sentence or one exact visual design (that would be over-fitting to
// wording) — they assert the STRUCTURAL facts a real campaign requires:
// which occasion/campaign was recognized, who it's for, which creative
// mode that produces, and how that mode's own schema (graphicTextSlots,
// ctaProminence, hierarchyDepth) actually differs from every other case.
//
// Exercises the real, already-shipped pipeline end to end — the same two
// functions marketing-studio.js itself calls before ever building an
// OpenAI creative brief — never a reimplementation or a mock of the
// classification logic.

function buildDirection(args) {
  const concept = buildCanonicalConcept(args);
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  return { concept, direction };
}

test("Quality gate: Homecoming event reminder — recognized as a major campaign with a real deadline, never collapsed to an ordinary everyday post", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "Homecoming Dance",
    requestText: "Remind students and parents the Homecoming Dance is September 19th, flowers need to be ordered as soon as possible",
    ctaText: "Order by Friday!"
  });
  assert.equal(concept.occasionCategory, "event_reminder");
  assert.equal(concept.namedCampaign, "homecoming");
  assert.equal(concept.audience, "students_and_parents");
  assert.equal(concept.creativeMode, "campaign_poster");
  assert.ok(concept.factRequirements.includes("event_date"), "a real order deadline must be tracked as a fact requirement, not lost");
  // Structural, not everyday: a real campaign poster shape, a strong CTA
  // (the actual "order early" objective), and the mandatory headline/brand
  // safeguard intact.
  assert.equal(direction.occasionTreatment, "seasonal_feature");
  assert.notEqual(direction.occasionTreatment, "everyday_floral");
  assert.equal(direction.ctaProminence, "strong");
  assert.equal(direction.graphicTextSlots.cta, true);
  assert.equal(direction.graphicTextSlots.headline, true);
  assert.equal(direction.graphicTextSlots.brand, true);
});

test("Quality gate: Valentine's Day campaign — recognized by name, romantic voice, distinct from Mother's Day despite both being 'holiday_seasonal'", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "Valentine's Day",
    requestText: "Valentine's Day flowers to surprise her this year",
    ctaText: "Order Now"
  });
  assert.equal(concept.occasionCategory, "holiday_seasonal");
  assert.equal(concept.namedCampaign, "valentines_day");
  assert.equal(concept.creativeMode, "campaign_poster");
  assert.ok(concept.copyVoice.includes("romantic"), "Valentine's own identity must reach copy voice, not just a generic holiday sentence");
  assert.equal(direction.occasionTreatment, "seasonal_feature");
  assert.equal(direction.ctaProminence, "strong");
});

test("Quality gate: Mother's Day campaign — same campaign_poster structure as Valentine's, but a genuinely different copy voice (celebratory/warm, never romantic)", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "Mother's Day",
    requestText: "Mother's Day flowers for mom, a gift she will love",
    ctaText: "Order Now"
  });
  assert.equal(concept.namedCampaign, "mothers_day");
  assert.equal(concept.creativeMode, "campaign_poster");
  assert.ok(concept.copyVoice.includes("celebratory"));
  assert.ok(concept.copyVoice.includes("warm"));
  assert.ok(!concept.copyVoice.includes("romantic"), "Mother's Day is not a romantic-partner occasion — must not inherit Valentine's voice");
  // Same STRUCTURAL family as Valentine's (both real campaigns)...
  assert.equal(direction.occasionTreatment, "seasonal_feature");
  // ...but a genuinely different named identity underneath it.
  assert.notEqual(concept.namedCampaign, "valentines_day");
});

test("Quality gate: photo-forward self-purchase post — schema-legally minimal, headline/brand genuinely absent, never forced back on", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "",
    requestText: "cute post about buying myself flowers, mostly photo, minimal text",
    ctaText: ""
  });
  assert.equal(concept.audience, "self_purchase");
  assert.equal(concept.creativeMode, "photo_forward_social");
  assert.equal(direction.occasionTreatment, "photo_forward_social");
  // The actual Part 4 fix: this family may legally omit headline AND brand —
  // never globally forced back to true the way every other family is.
  assert.equal(direction.graphicTextSlots.headline, false);
  assert.equal(direction.graphicTextSlots.brand, false);
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.ctaProminence, "none");
});

test("Quality gate: playful urgent 'forgot to order' promotion — a real promotion with a strong CTA, playful/urgent voice, never treated as a quiet everyday post", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "",
    requestText: "Forgot to order flowers?? Last chance to order before we close today, 20% off!",
    ctaText: "Order Now"
  });
  assert.equal(concept.promotionIntent, "real_promotion");
  assert.equal(concept.creativeMode, "playful_promotion");
  assert.ok(concept.copyVoice.includes("playful"));
  assert.ok(concept.copyVoice.includes("urgent"));
  assert.equal(direction.occasionTreatment, "promotional_feature");
  // The ctaProminenceCeiling latent-bug fix this batch also delivered:
  // a real promotion actually reaches "strong", not stuck at "subtle".
  assert.equal(direction.ctaProminence, "strong");
});

test("Quality gate: sympathy/funeral creative — compassionate/elegant voice, funeral_families audience, its own dedicated structural family with a service-detail slot no other case gets", () => {
  const { concept, direction } = buildDirection({
    occasionTitle: "Sympathy",
    requestText: "flowers for a funeral service",
    ctaText: "Call 555-0100",
    isSympathy: true
  });
  assert.equal(concept.occasionCategory, "sympathy");
  assert.equal(concept.audience, "funeral_families");
  assert.equal(concept.creativeMode, "sympathy_elegance");
  assert.deepEqual(concept.copyVoice, ["compassionate", "elegant"]);
  assert.equal(direction.occasionTreatment, "sympathy_elegance");
  // Sympathy is the one family that legitimately gets a serviceDetail slot —
  // structurally distinct from every promotional/campaign family above.
  assert.equal(direction.graphicTextSlots.serviceDetail, true);
  // Never a hard promotional sell on a sympathy request, regardless of any
  // urgent-sounding words elsewhere in the pipeline.
  assert.notEqual(direction.ctaProminence, "strong");
});

test("Quality gate: the six representative requests above produce genuinely DIFFERENT structural specifications, not just different wording of the same shape", () => {
  const cases = [
    { occasionTitle: "Homecoming Dance", requestText: "Remind students and parents the Homecoming Dance is September 19th, flowers need to be ordered as soon as possible", ctaText: "Order by Friday!" },
    { occasionTitle: "Valentine's Day", requestText: "Valentine's Day flowers to surprise her this year", ctaText: "Order Now" },
    { occasionTitle: "Mother's Day", requestText: "Mother's Day flowers for mom, a gift she will love", ctaText: "Order Now" },
    { occasionTitle: "", requestText: "cute post about buying myself flowers, mostly photo, minimal text", ctaText: "" },
    { occasionTitle: "", requestText: "Forgot to order flowers?? Last chance to order before we close today, 20% off!", ctaText: "Order Now" },
    { occasionTitle: "Sympathy", requestText: "flowers for a funeral service", ctaText: "Call 555-0100", isSympathy: true }
  ];
  const signatures = cases.map((args) => {
    const { concept, direction } = buildDirection(args);
    return JSON.stringify({
      occasionTreatment: direction.occasionTreatment,
      hierarchyDepth: direction.hierarchyDepth,
      ctaProminence: direction.ctaProminence,
      graphicTextSlots: direction.graphicTextSlots,
      creativeMode: concept.creativeMode,
      copyVoice: [...concept.copyVoice].sort()
    });
  });
  const distinctSignatures = new Set(signatures);
  assert.equal(distinctSignatures.size, cases.length, "every representative request must produce a genuinely distinct structural specification — a duplicate here means two different campaigns collapsed onto the same shape");
});

test("Quality gate: Part 4 non-negotiable — every family EXCEPT photo_forward_social still has headline/brand forced on, even under this batch's new schema-legal exemption", () => {
  const nonPhotoForwardCases = [
    { occasionTitle: "Homecoming Dance", requestText: "Homecoming Dance is September 19th, order flowers now", ctaText: "Order Now" },
    { occasionTitle: "Valentine's Day", requestText: "Valentine's Day flowers", ctaText: "Order Now" },
    { occasionTitle: "", requestText: "Just a regular Tuesday flower post for the shop", ctaText: "" },
    { occasionTitle: "Sympathy", requestText: "flowers for a funeral service", ctaText: "", isSympathy: true }
  ];
  for (const args of nonPhotoForwardCases) {
    const { direction } = buildDirection(args);
    assert.notEqual(direction.occasionTreatment, "photo_forward_social");
    assert.equal(direction.graphicTextSlots.headline, true, `headline must stay mandatory for ${JSON.stringify(args)}`);
    assert.equal(direction.graphicTextSlots.brand, true, `brand must stay mandatory for ${JSON.stringify(args)}`);
  }
});
