import test from "node:test";
import assert from "node:assert/strict";
import { buildBackgroundPromptFromBrief, attemptPremiumCreativeGeneration, PREMIUM_CREATIVE_STATES } from "../netlify/functions/_shared/marketing-premium-creative-orchestrator.js";
import { buildOpenAiCreativeBrief } from "../netlify/functions/_shared/marketing-openai-creative-brief.js";
import { buildDeterministicCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Batch 5.2 ("wire the Creative Director into the Premium prompt") —
// regression suite for buildBackgroundPromptFromBrief now that it routes
// through marketing-creative-director.js instead of a 4-field summary.

function brief({ factSafeCopyPlan = {}, verifiedShopBrandData = {}, canonicalConcept, creativeDirection } = {}) {
  const b = buildOpenAiCreativeBrief({ canonicalConcept, creativeDirection, factSafeCopyPlan, verifiedShopBrandData });
  assert.equal(b.ok, true);
  return b;
}

function concept(overrides = {}) {
  return { objective: "awareness", occasionCategory: "general", ctaIntent: "none", factRequirements: [], ...overrides };
}

test("protected exact facts (phone/date/price) never appear in the OpenAI-bound prompt", () => {
  const cc = concept({ ctaIntent: "call_shop" });
  const cd = buildDeterministicCreativeDirection({ canonicalConcept: cc });
  const b = brief({
    canonicalConcept: cc,
    creativeDirection: cd,
    factSafeCopyPlan: { headline: "Spring is here!", body: "Call 606-506-4039 to order for delivery on 4/12.", caption: "Prices start at $35." },
    verifiedShopBrandData: { name: "Lilies in Bloom", phone: "606-506-4039" }
  });
  const prompt = buildBackgroundPromptFromBrief(b, { canonicalConcept: cc, creativeDirection: cd });
  assert.doesNotMatch(prompt, /606-506-4039/);
  assert.doesNotMatch(prompt, /4\/12/);
  assert.doesNotMatch(prompt, /\$35/);
  assert.doesNotMatch(prompt, /Lilies in Bloom/);
  assert.match(prompt, /Do not include any readable text, numbers, logos, or signage/);
});

test("different occasion treatments produce meaningfully different visual direction in the final prompt", () => {
  const everydayCc = concept();
  const everydayCd = buildDeterministicCreativeDirection({ canonicalConcept: everydayCc });
  const everydayPrompt = buildBackgroundPromptFromBrief(brief({ canonicalConcept: everydayCc, creativeDirection: everydayCd }), { canonicalConcept: everydayCc, creativeDirection: everydayCd });

  const sympathyCc = concept({ occasionCategory: "sympathy" });
  const sympathyCd = buildDeterministicCreativeDirection({ canonicalConcept: sympathyCc });
  const sympathyPrompt = buildBackgroundPromptFromBrief(brief({ canonicalConcept: sympathyCc, creativeDirection: sympathyCd }), { canonicalConcept: sympathyCc, creativeDirection: sympathyCd });

  const promoCc = concept({ objective: "promotion", ctaIntent: "order_now" });
  const promoCd = buildDeterministicCreativeDirection({ canonicalConcept: promoCc });
  const promoPrompt = buildBackgroundPromptFromBrief(brief({ canonicalConcept: promoCc, creativeDirection: promoCd }), { canonicalConcept: promoCc, creativeDirection: promoCd });

  assert.notEqual(everydayPrompt, sympathyPrompt);
  assert.notEqual(everydayPrompt, promoPrompt);
  assert.notEqual(sympathyPrompt, promoPrompt);
  assert.match(sympathyPrompt, /quiet|respectful|hushed/i);
  assert.doesNotMatch(sympathyPrompt, /\bbold\b/i);
});

test("negative-space guidance in the prompt aligns with the creativeDirection's own textRegion — the same field the renderer uses to place typography", () => {
  const cc = concept();
  const cdLower = { ...buildDeterministicCreativeDirection({ canonicalConcept: cc }), textRegion: "negative_space_band_lower" };
  const cdBanner = { ...buildDeterministicCreativeDirection({ canonicalConcept: cc }), textRegion: "banner", compositionFamily: "banner_led", imagePlacement: "framed_block", backgroundTreatment: "framed_photo_block" };
  const promptLower = buildBackgroundPromptFromBrief(brief({ canonicalConcept: cc, creativeDirection: cdLower }), { canonicalConcept: cc, creativeDirection: cdLower });
  const promptBanner = buildBackgroundPromptFromBrief(brief({ canonicalConcept: cc, creativeDirection: cdBanner }), { canonicalConcept: cc, creativeDirection: cdBanner });
  assert.match(promptLower, /lower portion/i);
  assert.match(promptBanner, /banner/i);
});

test("generic-template language is present only as an avoidance instruction, never as something the model is told to do", () => {
  const cc = concept();
  const cd = buildDeterministicCreativeDirection({ canonicalConcept: cc });
  const prompt = buildBackgroundPromptFromBrief(brief({ canonicalConcept: cc, creativeDirection: cd }), { canonicalConcept: cc, creativeDirection: cd });
  const avoidIndex = prompt.indexOf("Avoid:");
  assert.ok(avoidIndex >= 0, "prompt must carry an explicit avoidance instruction");
  // Every mention of the generic-template failure vocabulary must occur
  // at or after "Avoid:" — never earlier, as a positive instruction.
  for (const phrase of ["generic AI-template", "blank center", "greeting-card symmetry", "clip-art"]) {
    const idx = prompt.indexOf(phrase);
    assert.ok(idx === -1 || idx >= avoidIndex, `"${phrase}" appeared before the avoidance instruction — looks like a positive instruction, not an avoidance`);
  }
});

test("the final prompt always stays under the provider's 4000-character limit, even for a maximally rich creativeDirection", () => {
  const cc = concept({ ctaIntent: "call_shop", occasionCategory: "event_reminder", factRequirements: ["event_date", "phone_number"] });
  const cd = {
    occasionTreatment: "elegant_editorial",
    compositionFamily: "layered_editorial",
    subjectPlacement: "left_third",
    imageCrop: "wide_environmental",
    imagePlacement: "framed_block",
    imageScale: "balanced",
    textRegion: "integrated_editorial_region",
    negativeSpaceStrategy: "generous",
    ctaProminence: "strong",
    headlineScale: "oversized",
    typographyPersonality: "serif_script_pairing",
    brandingPosition: "top_center",
    brandingScale: "prominent",
    ornamentalDensity: "rich",
    decorativeMotif: "watercolor_wash",
    borderStyle: "double_line",
    backgroundTreatment: "framed_photo_block",
    visualMood: "elegant_refined",
    paletteMood: "warm_luxury"
  };
  const longCopyPlan = {
    headline: "A".repeat(40),
    body: "This is a long, friendly, descriptive sentence about the shop's beautiful arrangements and how much care goes into every single bouquet we create for every occasion imaginable, from weddings to birthdays to everyday surprises. ".repeat(6),
    caption: "B".repeat(200)
  };
  const b = brief({ canonicalConcept: cc, creativeDirection: cd, factSafeCopyPlan: longCopyPlan, verifiedShopBrandData: { name: "Test Shop", phone: "555-123-4567" } });
  const prompt = buildBackgroundPromptFromBrief(b, { canonicalConcept: cc, creativeDirection: cd });
  assert.ok(prompt.length <= 4000, `prompt was ${prompt.length} chars, over the provider's 4000-char cutoff`);
  assert.match(prompt, /Do not include any readable text, numbers, logos, or signage/, "the safety-critical instruction must survive even a very long descriptive prompt");
});

test("end-to-end: attemptPremiumCreativeGeneration (mocked provider) sends the Creative Director's richer prompt, not the old 4-field summary", async () => {
  let capturedPrompt = null;
  const provider = {
    name: "openai",
    model: "gpt-image-2",
    configured: () => true,
    capabilities: () => ({ aspectRatios: ["1:1"], qualityTiers: ["low", "medium", "high"] }),
    estimateCost: () => ({ cents: 6, currency: "USD", cost_source: "openai_conservative_ceiling_estimate" }),
    generate: async (args) => {
      capturedPrompt = args.prompt;
      return { ok: true, url: "https://example.com/premium.png", actualCostCents: null, usage: null, costSource: undefined };
    }
  };
  const client = createFakeSupabaseClient([{ data: { id: "usage-prompt-1" }, error: null }, { data: null, error: null }]);
  const cc = concept({ objective: "promotion", ctaIntent: "order_now", promotionIntent: "real_promotion" });
  const cd = buildDeterministicCreativeDirection({ canonicalConcept: cc });
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: cc,
    creativeDirection: cd,
    env: { FLORISYN_ENV: "staging" },
    providerFactory: () => provider
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.SUCCESS);
  assert.ok(capturedPrompt, "generate() must have been called with a real prompt");
  assert.match(capturedPrompt, /bold|confident/i, "a promotional occasion treatment should reach the actual provider call, not just the unit-level brief");
  assert.doesNotMatch(capturedPrompt, /image prominence/i, "the old 4-field summary wording must no longer appear");
});
