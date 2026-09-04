import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenAiCreativeBrief, classifyBriefText, CREATIVE_BRIEF_VERSION } from "../netlify/functions/_shared/marketing-openai-creative-brief.js";

// Hybrid Marketing Studio, Batch 1, Parts 7/8: a pure, deterministic
// creative-brief builder for a future Premium AI Creative (OpenAI) call —
// not wired into any live generation path yet (Part 12). Every test here
// is pure function input/output — no network call, no live provider.

const CANONICAL_CONCEPT = Object.freeze({
  occasionCategory: "everyday_floral",
  objective: "sell",
  creativeFamily: "designed_flyer"
});

const CREATIVE_DIRECTION = Object.freeze({
  compositionFamily: "photo_dominant",
  imageScale: "dominant",
  paletteMood: "soft_pastel",
  visualMood: "bright_joyful",
  typographyPersonality: "clean_sans",
  ornamentalDensity: "light",
  brandingPosition: "bottom_center",
  brandingScale: "standard",
  brandIdentifier: "shop_name"
});

test("classifyBriefText: separates a fact-bearing sentence from a purely stylistic one", () => {
  const result = classifyBriefText("Spring is here! Call 606-506-4039 to order fresh bouquets today.");
  assert.deepEqual(result.styleText, ["Spring is here!"]);
  assert.equal(result.factCriticalText.length, 1);
  assert.match(result.factCriticalText[0], /606-506-4039/);
  assert.ok(result.factTokens.includes("606-506-4039"));
});

test("classifyBriefText: text with no fact tokens is entirely style text", () => {
  const result = classifyBriefText("Fresh spring blooms are here. Treat yourself today.");
  assert.equal(result.factCriticalText.length, 0);
  assert.equal(result.styleText.length, 2);
});

// Batch 5.3.1 ("business identifier fact-safety hardening"): a real
// staging finding proved a verified shop name mentioned in ordinary
// narrative copy (no phone/price/date/time token in that sentence) still
// reached styleText — and, downstream, the OpenAI-bound image prompt.
test("classifyBriefText: a sentence naming the shop's own verified name is fact-critical even with no other recognized fact token", () => {
  const result = classifyBriefText("Lilies in Bloom designs flowers for the moments that matter.", {
    verifiedIdentifiers: ["Lilies in Bloom"]
  });
  assert.equal(result.styleText.length, 0);
  assert.equal(result.factCriticalText.length, 1);
  assert.match(result.factCriticalText[0], /Lilies in Bloom/);
});

test("classifyBriefText: verified-name protection is case-insensitive and tolerates surrounding punctuation/apostrophes", () => {
  const upper = classifyBriefText("LILIES IN BLOOM has your spring flowers.", { verifiedIdentifiers: ["Lilies in Bloom"] });
  assert.equal(upper.styleText.length, 0);
  const possessive = classifyBriefText("Come see Lilies in Bloom's newest arrangements!", { verifiedIdentifiers: ["Lilies in Bloom"] });
  assert.equal(possessive.styleText.length, 0);
  const curlyApostropheIdentifier = classifyBriefText("Visit Sam’s Flowers today.", { verifiedIdentifiers: ["Sam's Flowers"] });
  assert.equal(curlyApostropheIdentifier.styleText.length, 0);
});

test("classifyBriefText: a different tenant's name is never protected unless it is the one actually supplied as verified", () => {
  // The exact scenario the hardening must never regress into: this
  // module must never hard-code any specific shop's name. Passing a
  // DIFFERENT shop's name as the verified identifier must not protect
  // "Lilies in Bloom" text, and passing no identifiers at all must not
  // either — only the caller's own real, supplied verifiedIdentifiers.
  const wrongTenant = classifyBriefText("Lilies in Bloom designs flowers for the moments that matter.", {
    verifiedIdentifiers: ["Rosewood Florals"]
  });
  assert.equal(wrongTenant.factCriticalText.length, 0);
  assert.equal(wrongTenant.styleText.length, 1);
  const noIdentifiers = classifyBriefText("Lilies in Bloom designs flowers for the moments that matter.");
  assert.equal(noIdentifiers.factCriticalText.length, 0);
  assert.equal(noIdentifiers.styleText.length, 1);
});

test("classifyBriefText: ordinary stylistic prose with no protected identifier still reaches styleText unchanged", () => {
  const result = classifyBriefText("Fresh spring blooms are here. Treat yourself today.", { verifiedIdentifiers: ["Lilies in Bloom"] });
  assert.equal(result.factCriticalText.length, 0);
  assert.equal(result.styleText.length, 2);
});

test("classifyBriefText: verified-name protection never broadens into a substring match on an unrelated word", () => {
  // "Bloom" alone must never match inside "Bloomington" or "blooming" —
  // whole-phrase, word-boundary matching only.
  const result = classifyBriefText("Our Bloomington greenhouse is blooming early this year.", { verifiedIdentifiers: ["Lilies in Bloom"] });
  assert.equal(result.factCriticalText.length, 0, "a substring/partial-word match would incorrectly flag this as fact-critical");
});

test("classifyBriefText: phone/date/price/promotion protection is unaffected by verified-identifier hardening", () => {
  const result = classifyBriefText("Lilies in Bloom is proud to serve you. Call 606-506-4039 to order for delivery on 4/12. Get 20% off all bouquets this week.", {
    verifiedIdentifiers: ["Lilies in Bloom"]
  });
  assert.equal(result.styleText.length, 0, "every sentence here carries either the shop name, a phone/date fact, or a promotion claim");
  assert.equal(result.factCriticalText.length, 3);
});

// Independent-review finding, Batch 2: a discount/percentage claim has
// no phone/price/date/time token (extractFactTokens has no such pattern)
// but is still exactly the kind of fact-critical claim that must never
// be trusted to generative typography.
test("classifyBriefText: a promotional/discount sentence is fact-critical even with no phone/price/date/time token", () => {
  const result = classifyBriefText("Get 20% off all bouquets this week only!");
  assert.equal(result.styleText.length, 0, "a discount claim must never land in styleText");
  assert.equal(result.factCriticalText.length, 1);
  assert.match(result.factCriticalText[0], /20% off/);
});

test("classifyBriefText: a mixed sentence (style + a promotional claim in a second sentence) separates correctly", () => {
  const result = classifyBriefText("Spring is here! Enjoy a special offer on all arrangements this week.");
  assert.deepEqual(result.styleText, ["Spring is here!"]);
  assert.equal(result.factCriticalText.length, 1);
  assert.match(result.factCriticalText[0], /special offer/i);
});

test("classifyBriefText: empty/missing text classifies as nothing, never throws", () => {
  assert.deepEqual(classifyBriefText(""), { factTokens: [], styleText: [], factCriticalText: [] });
  assert.deepEqual(classifyBriefText(undefined), { factTokens: [], styleText: [], factCriticalText: [] });
});

test("buildOpenAiCreativeBrief: refuses to build without a real canonicalConcept or creativeDirection, rather than guessing defaults", () => {
  assert.equal(buildOpenAiCreativeBrief({ creativeDirection: CREATIVE_DIRECTION }).ok, false);
  assert.equal(buildOpenAiCreativeBrief({ canonicalConcept: CANONICAL_CONCEPT }).ok, false);
  assert.equal(buildOpenAiCreativeBrief({}).ok, false);
});

test("buildOpenAiCreativeBrief: version and every declared field are carried through from the real canonical concept / creative direction, never invented", () => {
  const brief = buildOpenAiCreativeBrief({ canonicalConcept: CANONICAL_CONCEPT, creativeDirection: CREATIVE_DIRECTION });
  assert.equal(brief.ok, true);
  assert.equal(brief.version, CREATIVE_BRIEF_VERSION);
  assert.equal(brief.occasion, CANONICAL_CONCEPT.occasionCategory);
  assert.equal(brief.objective, CANONICAL_CONCEPT.objective);
  assert.equal(brief.visualFamily, CANONICAL_CONCEPT.creativeFamily);
  assert.equal(brief.compositionIntent, CREATIVE_DIRECTION.compositionFamily);
  assert.equal(brief.imageProminence, CREATIVE_DIRECTION.imageScale);
  assert.equal(brief.paletteMood, CREATIVE_DIRECTION.paletteMood);
  assert.equal(brief.visualMood, CREATIVE_DIRECTION.visualMood);
  assert.equal(brief.typographyPersonality, CREATIVE_DIRECTION.typographyPersonality);
  assert.equal(brief.ornamentAmount, CREATIVE_DIRECTION.ornamentalDensity);
  assert.deepEqual(brief.brandingTreatment, {
    position: CREATIVE_DIRECTION.brandingPosition,
    scale: CREATIVE_DIRECTION.brandingScale,
    identifier: CREATIVE_DIRECTION.brandIdentifier
  });
});

// Required test #17 area / #18: brief-contains-only-grounded-facts.
test("Batch1 #18 brief-contains-only-grounded-facts: factsAllowed only ever contains the verified shop record and fact tokens already present in the fact-safe copy plan — never invented values", () => {
  const brief = buildOpenAiCreativeBrief({
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: { headline: "Spring is here!", body: "Call 606-506-4039 to order fresh spring bouquets today.", cta: "Order now" },
    verifiedShopBrandData: { name: "Lilies in Bloom", phone: "606-506-4039" }
  });
  const types = brief.factsAllowed.map((f) => f.type);
  assert.deepEqual(types.sort(), ["fact_token", "phone", "shop_name"]);
  assert.ok(brief.factsAllowed.some((f) => f.type === "shop_name" && f.value === "Lilies in Bloom"));
  assert.ok(brief.factsAllowed.some((f) => f.type === "fact_token" && f.value === "606-506-4039"));
  // No unverified value (e.g. an invented discount) can appear — the
  // structural guarantee is that factsAllowed is built ONLY from
  // verifiedShopBrandData + extractFactTokens output, never from an
  // arbitrary string the caller might pass elsewhere.
  assert.ok(!JSON.stringify(brief.factsAllowed).toLowerCase().includes("50% off"));
});

test("buildOpenAiCreativeBrief: with no verified brand data and no copy plan, factsAllowed is honestly empty, never fabricated", () => {
  const brief = buildOpenAiCreativeBrief({ canonicalConcept: CANONICAL_CONCEPT, creativeDirection: CREATIVE_DIRECTION });
  assert.deepEqual(brief.factsAllowed, []);
});

// Required test #17: critical-fact-tokens-separated.
test("Batch1 #17 critical-fact-tokens-separated: fact-bearing sentences land in deterministicText, never in styleText, across every copy field", () => {
  const brief = buildOpenAiCreativeBrief({
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: {
      headline: "Spring is here!",
      body: "Call 606-506-4039 to order fresh spring bouquets today.",
      cta: "Order now",
      caption: "Prices start at $35."
    }
  });
  const allStyle = brief.styleText.map((s) => s.text).join(" | ");
  const allDeterministic = brief.deterministicText.map((s) => s.text).join(" | ");
  assert.ok(!allStyle.includes("606-506-4039"), "a phone number must never leak into styleText");
  assert.ok(!allStyle.includes("$35"), "a price must never leak into styleText");
  assert.ok(allDeterministic.includes("606-506-4039"));
  assert.ok(allDeterministic.includes("$35"));
  assert.ok(allStyle.includes("Spring is here!"));
  assert.ok(allStyle.includes("Order now"));
});

// Required test #19: reference-image-cannot-become-fact-source.
test("Batch1 #19 reference-image-cannot-become-fact-source: a reference image's description is never merged into factsAllowed, no matter what it claims", () => {
  const brief = buildOpenAiCreativeBrief({
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    referenceImageMeta: { description: "same-day delivery available, call 555-000-1111, 50% off today only" }
  });
  assert.equal(brief.referenceImage.present, true);
  assert.equal(brief.referenceImage.description, "same-day delivery available, call 555-000-1111, 50% off today only");
  // The description text is echoed back ONLY as reference metadata — it
  // must never appear inside factsAllowed, which is built exclusively
  // from verifiedShopBrandData + factSafeCopyPlan.
  assert.deepEqual(brief.factsAllowed, [], "factsAllowed must stay empty — a reference image's own claims can never populate it");
  assert.ok(brief.factsForbiddenFromInvention.some((r) => r.toLowerCase().includes("reference image")));
});

test("buildOpenAiCreativeBrief: with no reference image supplied, referenceImage.present is honestly false", () => {
  const brief = buildOpenAiCreativeBrief({ canonicalConcept: CANONICAL_CONCEPT, creativeDirection: CREATIVE_DIRECTION });
  assert.deepEqual(brief.referenceImage, { present: false });
});

test("buildOpenAiCreativeBrief: factsForbiddenFromInvention always includes the same-day-delivery/open-now reminder and the no-literal-text-in-image rule", () => {
  const brief = buildOpenAiCreativeBrief({ canonicalConcept: CANONICAL_CONCEPT, creativeDirection: CREATIVE_DIRECTION });
  const joined = brief.factsForbiddenFromInvention.join(" ").toLowerCase();
  assert.ok(joined.includes("same-day delivery"));
  assert.ok(joined.includes("literal words"));
});

test("buildOpenAiCreativeBrief is pure/deterministic: identical inputs always produce an identical brief", () => {
  const input = {
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: { headline: "Spring is here!", body: "Call 606-506-4039 today." },
    verifiedShopBrandData: { name: "Lilies in Bloom" }
  };
  const first = buildOpenAiCreativeBrief(input);
  const second = buildOpenAiCreativeBrief(input);
  assert.deepEqual(first, second);
});

// Batch 5.3.1: end-to-end proof at the buildOpenAiCreativeBrief level —
// not just the lower-level classifyBriefText unit — that the shop's own
// verified name/address never lands in styleText (and therefore never
// reaches the OpenAI-bound image prompt built from it).
test("buildOpenAiCreativeBrief: the shop's own verified name never appears in styleText, even mentioned only in narrative copy", () => {
  const brief = buildOpenAiCreativeBrief({
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: {
      headline: "Beautiful Blooms, Thoughtfully Arranged",
      body: "Lilies in Bloom designs flowers for the moments that matter — a little something to brighten someone's day."
    },
    verifiedShopBrandData: { name: "Lilies in Bloom", phone: "606-506-4039" }
  });
  const styleJoined = brief.styleText.map((s) => s.text).join(" ");
  assert.doesNotMatch(styleJoined, /Lilies in Bloom/);
  assert.ok(brief.deterministicText.some((s) => s.text.includes("Lilies in Bloom")), "the shop-name sentence must be reserved for deterministic overlay instead");
});

test("buildOpenAiCreativeBrief: the shop's own verified address, when supplied, is also protected from styleText", () => {
  const brief = buildOpenAiCreativeBrief({
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: { body: "Stop by our shop at 123 Main Street for the freshest arrangements in town." },
    verifiedShopBrandData: { name: "Lilies in Bloom", address: "123 Main Street" }
  });
  const styleJoined = brief.styleText.map((s) => s.text).join(" ");
  assert.doesNotMatch(styleJoined, /123 Main Street/);
});
