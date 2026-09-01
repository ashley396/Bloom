import test from "node:test";
import assert from "node:assert/strict";
import { deriveApprovalObservations, dedupeTraits } from "../netlify/functions/_shared/marketing-approval-learning.js";

// Batch 5 ("Repair recent-content diversity + brand-memory learning"),
// Part H/I/J/L: deriveApprovalObservations is the one NEW source of
// learning evidence — deterministic, structural, artifact-derived — that
// lets a genuinely new inferred preference actually accumulate (the old
// path, a generation's own self-reported traits_used, is grounded through
// traitsGroundedInSummary and can therefore only ever echo a trait that
// was ALREADY active — never a source for something brand new).

test("deriveApprovalObservations: a short caption produces exactly one 'concise captions' observation — Part Q #25", () => {
  const asset = { asset_type: "social_copy", content: { body: "Fresh flowers today, come see us!" } };
  const { brandObservations } = deriveApprovalObservations(asset);
  assert.equal(brandObservations.length, 1);
  assert.deepEqual(brandObservations[0], { category: "content_density", text: "concise captions", polarity: "positive" });
});

test("deriveApprovalObservations: a long, detailed caption produces a 'detailed storytelling' observation instead", () => {
  const longBody = "Every arrangement we build starts the same way — ".repeat(15);
  const asset = { asset_type: "social_copy", content: { body: longBody } };
  const { brandObservations } = deriveApprovalObservations(asset);
  assert.deepEqual(brandObservations, [{ category: "content_density", text: "detailed storytelling", polarity: "positive" }]);
});

test("deriveApprovalObservations: a plain photo post (no on-image text) produces a photography-first visual observation", () => {
  const asset = { asset_type: "image", content: { body: "Fresh today.", canonical_concept: { creativeFamily: "plain_photo_post" } } };
  const { visualObservations } = deriveApprovalObservations(asset);
  assert.deepEqual(visualObservations, [{ category: "product_photo_style", text: "photography-first, minimal on-image text", polarity: "positive" }]);
});

test("deriveApprovalObservations: a designed flyer produces a different visual observation, never the same text as a plain photo post", () => {
  const asset = { asset_type: "flyer", content: { body: "Fresh today.", canonical_concept: { creativeFamily: "designed_flyer" } } };
  const { visualObservations } = deriveApprovalObservations(asset);
  assert.deepEqual(visualObservations, [{ category: "flyer_style", text: "fully designed flyer with on-image text", polarity: "positive" }]);
});

test("deriveApprovalObservations: legacy content with no canonical_concept still gets a real fallback classification (Part F reused)", () => {
  const asset = { asset_type: "image", content: { body: "Fresh today." } }; // no canonical_concept at all
  const { visualObservations } = deriveApprovalObservations(asset);
  assert.deepEqual(visualObservations, [{ category: "product_photo_style", text: "photography-first, minimal on-image text", polarity: "positive" }]);
});

// Part Q #41: temporary inventory/promotion facts never become style memory.
test("deriveApprovalObservations: never derives anything from inventory grounding, promotions, or facts — only structural artifact properties", () => {
  const asset = {
    asset_type: "flyer",
    content: {
      body: "Take 20% off peonies this weekend only, order today!",
      cta: "Order now",
      canonical_concept: { creativeFamily: "designed_flyer", objective: "promotion", promotionIntent: "real_promotion" },
      grounded_in_inventory: [{ name: "Peony", quantity: 40 }]
    }
  };
  const { brandObservations, visualObservations } = deriveApprovalObservations(asset);
  const allText = [...brandObservations, ...visualObservations].map((o) => o.text.toLowerCase()).join(" ");
  assert.doesNotMatch(allText, /peon|20%|promotion|order now|inventory/, "no inventory/promotion/fact detail must ever leak into a learning observation");
});

// Part Q #42: generated visual-fiction details never become memory.
test("deriveApprovalObservations: never derives anything from creative_brief/visual_brief scene text", () => {
  const asset = {
    asset_type: "image",
    content: {
      body: "Fresh today.",
      visual_brief: "A jaguar mascot holding a bouquet of peonies on a marble counter under golden light",
      creative_brief: { primary_subject: "a jaguar mascot holding peonies", mood: "dramatic", lighting: "golden hour" },
      canonical_concept: { creativeFamily: "plain_photo_post" }
    }
  };
  const { brandObservations, visualObservations } = deriveApprovalObservations(asset);
  const allText = [...brandObservations, ...visualObservations].map((o) => o.text.toLowerCase()).join(" ");
  assert.doesNotMatch(allText, /jaguar|peon|marble|golden|mascot/, "no scene/visual-fiction detail must ever leak into a learning observation");
});

test("deriveApprovalObservations: an asset with no real caption and no recognized creative family produces no observations at all", () => {
  const asset = { asset_type: "video_concept", content: { url: "https://example.com/x.jpg" } };
  const result = deriveApprovalObservations(asset);
  assert.deepEqual(result.brandObservations, []);
  assert.deepEqual(result.visualObservations, []);
});

// Part Q #27/#43: duplicate metadata (the same trait named twice, whether
// from two sources or two assets in the same approval event) counts once.
test("dedupeTraits: the exact same category+text+polarity appearing twice collapses to one entry", () => {
  const traits = [
    { category: "content_density", text: "concise captions", polarity: "positive" },
    { category: "content_density", text: "Concise Captions", polarity: "positive" }, // different case — same real trait
    { category: "content_density", text: "concise captions", polarity: "positive" }
  ];
  const result = dedupeTraits(traits);
  assert.equal(result.length, 1);
});

test("dedupeTraits: the same text under a different category, or a different polarity, is NOT collapsed — those are genuinely different traits", () => {
  const traits = [
    { category: "content_density", text: "minimal", polarity: "positive" },
    { category: "mood", text: "minimal", polarity: "positive" },
    { category: "content_density", text: "minimal", polarity: "negative" }
  ];
  const result = dedupeTraits(traits);
  assert.equal(result.length, 3);
});

test("dedupeTraits: garbage entries (no category/text) are dropped, never crash", () => {
  const result = dedupeTraits([null, {}, { category: "mood" }, { text: "x" }, { category: "mood", text: "elegant", polarity: "positive" }]);
  assert.equal(result.length, 1);
});
