import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_CONCEPT_VERSION,
  SOCIAL_POST_OBJECTIVES,
  CONCEPT_IDENTITY_FIELDS,
  buildCanonicalConcept,
  inheritConcept,
  classifyOccasionCategory,
  classifyPrimarySubjectClass,
  classifyCaptionIntent,
  classifyCtaIntent,
  deriveAssetRoute,
  deriveCreativeFamily,
  deriveFactRequirements,
  detectExplicitConceptChangeRequest,
  detectConceptDrift,
  detectImageSubjectDrift
} from "../netlify/functions/_shared/marketing-canonical-concept.js";

// Batch 4 ("Persisted canonical concept + revision enforcement") — unit
// coverage for the standalone concept module, before it's wired into
// generate_content/revise_content (see marketing-studio-canonical-concept*
// test files for the handler-level tests).

test("SOCIAL_POST_OBJECTIVES is re-exported unchanged from ai-creative-engine.js — never a second, competing enum", () => {
  assert.deepEqual(SOCIAL_POST_OBJECTIVES, ["awareness", "promotion", "retention", "operational", "seasonal_occasion"]);
});

test("buildCanonicalConcept: a plain decorative post gets a sensible, fully-populated concept", () => {
  const concept = buildCanonicalConcept({
    requestText: "A bright, romantic bouquet post for Facebook",
    occasionTitle: "Fresh roses",
    platform: "facebook",
    contentType: "image_post",
    assetType: "flyer",
    objective: "awareness",
    primarySubject: "A bright bouquet of roses on a marble counter",
    ctaText: "Visit us today",
    bodyText: "Fresh roses just arrived!",
    isSympathy: false,
    photoStrategy: "subject_forward",
    styleTier: "generated",
    invGroundedCount: 0
  });
  assert.equal(concept.version, CANONICAL_CONCEPT_VERSION);
  assert.equal(concept.objective, "awareness");
  assert.equal(concept.occasionCategory, "general");
  assert.equal(concept.primarySubjectClass, "floral_arrangement");
  assert.equal(concept.captionIntent, "informational");
  assert.equal(concept.ctaIntent, "visit_shop");
  assert.equal(concept.creativeFamily, "designed_flyer");
  assert.equal(concept.assetRoute, "ai_generated_photo");
  assert.equal(concept.sympathyClassification, "not_sympathy");
  assert.equal(concept.inventoryIntent, "not_inventory_driven");
  assert.equal(concept.promotionIntent, "not_promotion");
  assert.equal(concept.platform, "facebook");
});

test("buildCanonicalConcept: a real sympathy request classifies occasionCategory/captionIntent/sympathyClassification consistently, from the SAME detector", () => {
  const concept = buildCanonicalConcept({
    requestText: "Flowers for the Smith family, they just lost their dad",
    isSympathy: true,
    primarySubject: "A dignified white standing spray",
    objective: "awareness"
  });
  assert.equal(concept.occasionCategory, "sympathy");
  assert.equal(concept.captionIntent, "sympathetic");
  assert.equal(concept.sympathyClassification, "sympathy");
});

test("buildCanonicalConcept: an operational notice classifies as operational_notice/operational_notice", () => {
  const concept = buildCanonicalConcept({ requestText: "We're closing at 2:30 today.", objective: "operational", isSympathy: false });
  assert.equal(concept.occasionCategory, "operational_notice");
  assert.equal(concept.captionIntent, "operational_notice");
});

test("classifyOccasionCategory: recognizes real florist occasion keywords, never invents one nothing supports", () => {
  assert.equal(classifyOccasionCategory({ requestText: "Order your birthday bouquet today" }), "birthday");
  assert.equal(classifyOccasionCategory({ requestText: "Our wedding season is here" }), "wedding_event");
  assert.equal(classifyOccasionCategory({ requestText: "Congrats grads! Graduation bouquets available" }), "graduation");
  assert.equal(classifyOccasionCategory({ requestText: "A totally generic post" }), "general");
});

// Batch 5.3 ("event/deadline classification") regression: every existing
// occasion classification above must remain byte-for-byte unchanged —
// the new event_reminder rule is additive only, never a reclassification
// of any request shape that already resolved to something real.
test("Batch 5.3 regression: every pre-existing occasion classification is unchanged by the new event_reminder rule", () => {
  assert.equal(classifyOccasionCategory({ requestText: "Order your birthday bouquet today" }), "birthday");
  assert.equal(classifyOccasionCategory({ requestText: "Happy anniversary to a wonderful couple" }), "anniversary");
  assert.equal(classifyOccasionCategory({ requestText: "Our wedding season is here" }), "wedding_event");
  assert.equal(classifyOccasionCategory({ requestText: "Congrats grads! Graduation bouquets available" }), "graduation");
  assert.equal(classifyOccasionCategory({ requestText: "New baby shower bouquets now available" }), "new_baby");
  assert.equal(classifyOccasionCategory({ requestText: "Get well soon flowers for a loved one" }), "get_well");
  assert.equal(classifyOccasionCategory({ requestText: "A totally generic post" }), "general");
  assert.equal(classifyOccasionCategory({ requestText: "Create today's Facebook post for Lilies in Bloom." }), "general");
  assert.equal(classifyOccasionCategory({ requestText: "We're closing at 2:30 today.", objective: "operational" }), "operational_notice");
  assert.equal(classifyOccasionCategory({ requestText: "Deep sympathy for your loss", isSympathy: true }), "sympathy");
  assert.equal(classifyOccasionCategory({ requestText: "Fall is here, order your seasonal arrangement", objective: "seasonal_occasion" }), "holiday_seasonal");
  // A shop discussing a real "formal arrangement" (an ordinary florist
  // term, not a school event) must never false-positive on the new rule.
  assert.equal(classifyOccasionCategory({ requestText: "We offer a formal arrangement style for any occasion" }), "general");
  // Nor an unrelated use of "prom" as a word fragment inside another word.
  assert.equal(classifyOccasionCategory({ requestText: "We promptly fulfill every order" }), "general");
});

test("Batch 5.3: a named school-dance-style event reminder now classifies as event_reminder, not general", () => {
  assert.equal(classifyOccasionCategory({ requestText: "Remind everyone the Homecoming Dance is September 19th, order corsages and boutonnieres soon." }), "event_reminder");
  assert.equal(classifyOccasionCategory({ requestText: "Prom is next Saturday, remind everyone to order their flowers." }), "event_reminder");
  assert.equal(classifyOccasionCategory({ requestText: "Our school dance is coming up, order your corsage now." }), "event_reminder");
  assert.equal(classifyOccasionCategory({ requestText: "The school formal is this weekend — order boutonnieres today." }), "event_reminder");
});

test("Batch 5.3: buildCanonicalConcept carries event_reminder through as occasionCategory, and it feeds factRequirements/ctaIntent exactly as any other category would — no special-casing elsewhere", () => {
  const concept = buildCanonicalConcept({
    requestText: "Remind Students and Parents the Homecoming Dance is September 19th, order corsages and boutonnieres soon.",
    ctaText: "Order your Homecoming flowers early.",
    objective: "awareness"
  });
  assert.equal(concept.occasionCategory, "event_reminder");
  assert.equal(concept.ctaIntent, "order_now");
});

test("classifyPrimarySubjectClass: defaults to floral_arrangement, the real common case — never a guess when there's real subject text", () => {
  assert.equal(classifyPrimarySubjectClass("A bright bouquet of roses"), "floral_arrangement");
  assert.equal(classifyPrimarySubjectClass("A jaguar mascot holding a bouquet"), "mascot_or_character");
  assert.equal(classifyPrimarySubjectClass("A bride and groom with their bouquet"), "people_or_lifestyle");
  assert.equal(classifyPrimarySubjectClass("Our shop storefront exterior"), "storefront_or_location");
  assert.equal(classifyPrimarySubjectClass(""), "other");
});

test("classifyCtaIntent: deterministic keyword classification, 'none' only when there's truly no CTA text", () => {
  assert.equal(classifyCtaIntent("Call 606-506-4039"), "call_shop");
  assert.equal(classifyCtaIntent("Order now"), "order_now");
  assert.equal(classifyCtaIntent("Visit us today"), "visit_shop");
  assert.equal(classifyCtaIntent("Learn more"), "learn_more");
  assert.equal(classifyCtaIntent("Reach out anytime"), "contact_general");
  assert.equal(classifyCtaIntent(""), "none");
  assert.equal(classifyCtaIntent(null), "none");
});

test("deriveAssetRoute: reuses the existing photo_choice/photo_strategy/style_tier fields, never a contradictory label", () => {
  assert.equal(deriveAssetRoute({ userUploadedPhoto: true }), "real_shop_photo");
  assert.equal(deriveAssetRoute({ reusedFromAssetId: "asset-1" }), "prior_real_photo");
  assert.equal(deriveAssetRoute({ photoStrategy: "subject_forward", styleTier: "generated" }), "ai_generated_photo");
  assert.equal(deriveAssetRoute({ photoStrategy: "calm_backdrop", styleTier: "generated" }), "flyer_background");
  assert.equal(deriveAssetRoute({ styleTier: "template" }), "deterministic_template");
  assert.equal(deriveAssetRoute({ contentType: "reel" }), "video_concept");
  assert.equal(deriveAssetRoute({}), "none");
  // Uploaded photo always wins over a stale/irrelevant styleTier — a real
  // photo the florist supplied is never relabeled as AI-generated.
  assert.equal(deriveAssetRoute({ userUploadedPhoto: true, styleTier: "generated" }), "real_shop_photo");
});

test("deriveCreativeFamily: a direct structural mapping off the real asset/content type", () => {
  assert.equal(deriveCreativeFamily({ assetType: "flyer" }), "designed_flyer");
  assert.equal(deriveCreativeFamily({ assetType: "video_concept" }), "video_concept");
  assert.equal(deriveCreativeFamily({ contentType: "reel" }), "video_concept");
  assert.equal(deriveCreativeFamily({ assetType: "image" }), "plain_photo_post");
  assert.equal(deriveCreativeFamily({ assetType: "social_copy" }), "text_only");
});

test("deriveFactRequirements: never invents a requirement nothing in the request actually supports; never stores scene detail as a fact", () => {
  assert.deepEqual(deriveFactRequirements({}), []);
  const withPhone = deriveFactRequirements({ ctaText: "Call 606-506-4039" });
  assert.ok(withPhone.includes("phone_number"));
  const withPromo = deriveFactRequirements({ objective: "promotion" });
  assert.ok(withPromo.includes("promotion"));
  const withInventory = deriveFactRequirements({ invGroundedCount: 3 });
  assert.ok(withInventory.includes("inventory_grounding"));
  const withHours = deriveFactRequirements({ requestText: "We are open until 6pm today" });
  assert.ok(withHours.includes("shop_hours"));
  const withDelivery = deriveFactRequirements({ requestText: "We now offer same-day delivery" });
  assert.ok(withDelivery.includes("delivery_service"));
  // A vivid creative scene description alone (no real fact keyword) must
  // never produce a fact requirement — that's fiction, not a shop fact.
  assert.deepEqual(deriveFactRequirements({ bodyText: "A dreamy sunset garden full of wildflowers" }), []);
});

// ---------------------------------------------------------------------------
// Batch 3 staging-acceptance fix: deriveFactRequirements' event_date
// semantics. Authoritative-source fix (not a router-level workaround) —
// see marketing-canonical-concept.js's own hasMaterialTimingCommitment()
// doc comment for the real live staging failure this closes.
// ---------------------------------------------------------------------------

// Test A/B: the exact real staging-observed false positive and its
// close variants — a bare "today's <content-noun>" must never create an
// event_date requirement.
test("Batch3 A/B — event_date: 'today's <post/idea>' phrasing never creates an event_date requirement", () => {
  assert.ok(!deriveFactRequirements({ requestText: "Create today's Facebook post for Lilies in Bloom." }).includes("event_date"));
  assert.ok(!deriveFactRequirements({ requestText: "Write today's social post." }).includes("event_date"));
  assert.ok(!deriveFactRequirements({ requestText: "Today's marketing idea" }).includes("event_date"));
  assert.ok(!deriveFactRequirements({ requestText: "Create today's featured-arrangement post" }).includes("event_date"));
});

// Tests C-G: a date/time expression genuinely tied to a business
// commitment (closing, a sale window, a class, reopening, an event) must
// still create event_date.
test("Batch3 C-G — event_date: a genuine business date/time commitment is still detected", () => {
  assert.ok(deriveFactRequirements({ requestText: "Closing today at 3 PM." }).includes("event_date"));
  assert.ok(deriveFactRequirements({ requestText: "Sale ends today." }).includes("event_date"));
  assert.ok(deriveFactRequirements({ requestText: "Our flower class is September 12." }).includes("event_date"), "an explicit calendar date (month + day) tied to a scheduled class must be detected");
  assert.ok(deriveFactRequirements({ requestText: "We reopen tomorrow." }).includes("event_date"));
  assert.ok(deriveFactRequirements({ requestText: "Create a post about our event next Friday." }).includes("event_date"));
  assert.ok(deriveFactRequirements({ requestText: "Our class is today at 6 PM." }).includes("event_date"));
});

test("Batch3 — event_date: a commitment word in one sentence and a time word in an unrelated sentence do not combine (sentence-scoped, not haystack-wide)", () => {
  // The exact real shape of the staging failure once a rescue CTA is
  // appended: the CTA's own "order" (a commitment word) must never
  // combine with an unrelated sentence's incidental "today".
  const result = deriveFactRequirements({
    requestText: "Create today's Facebook post for Lilies in Bloom.",
    ctaText: "Call 606-506-4039 to place an order."
  });
  assert.ok(!result.includes("event_date"), "a commitment word in the CTA sentence must not combine with an unrelated sentence's own incidental time word");
});

// Tests H/I: phone_number is only ever derived from an actual phone
// number appearing in the request/CTA/body text — never merely because
// the shop HAS a verified phone number (which isn't even an input to
// this function at all) — confirming Part 3's verified_fact_available
// vs fact_required_by_request_or_copy distinction already holds
// structurally, with no code change needed for it.
test("Batch3 H — phone_number is never required merely because a verified shop phone exists; deriveFactRequirements has no shopPhone input at all", () => {
  const result = deriveFactRequirements({ requestText: "Create today's Facebook post for Lilies in Bloom." });
  assert.ok(!result.includes("phone_number"), "no phone number appears anywhere in the request/CTA/body, so none can be required — a verified shop phone is a separate, later grounding concern, never an input here");
});

test("Batch3 I — phone_number IS required once a real phone number actually appears in the request or generated copy", () => {
  assert.ok(deriveFactRequirements({ requestText: "Call us at 606-506-4039" }).includes("phone_number"));
  assert.ok(deriveFactRequirements({ ctaText: "Call 606-506-4039 to place an order." }).includes("phone_number"));
});

// ---------------------------------------------------------------------------
// inheritConcept — Part D
// ---------------------------------------------------------------------------

test("inheritConcept: with no overrides, every field survives byte-for-byte — the ordinary revision case", () => {
  const parent = buildCanonicalConcept({ requestText: "Birthday bouquet", objective: "awareness", primarySubject: "roses" });
  const inherited = inheritConcept(parent, {});
  assert.deepEqual(inherited, { ...parent, version: CANONICAL_CONCEPT_VERSION });
});

test("inheritConcept: an override changes ONLY the named field(s), everything else is untouched", () => {
  const parent = buildCanonicalConcept({ requestText: "Birthday bouquet", objective: "awareness", primarySubject: "roses" });
  const inherited = inheritConcept(parent, { objective: "promotion", promotionIntent: "real_promotion" });
  assert.equal(inherited.objective, "promotion");
  assert.equal(inherited.promotionIntent, "real_promotion");
  assert.equal(inherited.occasionCategory, parent.occasionCategory);
  assert.equal(inherited.primarySubjectClass, parent.primarySubjectClass);
  assert.equal(inherited.assetRoute, parent.assetRoute);
});

test("inheritConcept: visualDirection overrides merge, never wholesale-replace the nested object", () => {
  const parent = buildCanonicalConcept({ requestText: "x", creativeBrief: { mood: "cheerful", lighting: "natural" } });
  const inherited = inheritConcept(parent, { visualDirection: { lighting: "bright, sunlit" } });
  assert.equal(inherited.visualDirection.lighting, "bright, sunlit");
  assert.equal(inherited.visualDirection.mood, "cheerful", "an unrelated visualDirection field must survive the merge");
});

test("inheritConcept: null parent returns null — never fabricates a concept from nothing", () => {
  assert.equal(inheritConcept(null, {}), null);
});

// ---------------------------------------------------------------------------
// detectExplicitConceptChangeRequest — Part E
// ---------------------------------------------------------------------------

test("detectExplicitConceptChangeRequest: ordinary wording/visual tweaks are NEVER detected as concept changes", () => {
  for (const instruction of [
    "Make the caption shorter",
    "Make it warmer",
    "Make it more professional",
    "Make it more playful",
    "Rewrite the hook",
    "Give me another caption",
    "Make the image brighter",
    "Regenerate the image",
    "Change the background to a marble counter",
    // Independent-review regression (HIGH): these all matched the old
    // "focus on X instead of Y" / "make this about X instead" rules on
    // ANY noun pair, silently mislabeling an ordinary emphasis/tone tweak
    // as a deliberate subject/occasion change. Neither X nor Y here names
    // a real occasion or subject-class keyword, so none of these may
    // count as an explicit concept change.
    "focus on roses instead of tulips",
    "focus on freshness instead of price",
    "make this about value instead of speed"
  ]) {
    const result = detectExplicitConceptChangeRequest(instruction);
    assert.equal(result.changed, false, `"${instruction}" must NOT be detected as a concept change`);
    assert.deepEqual(result.fields, []);
  }
});

// Independent-review regression (HIGH): "focus on X instead of Y" and
// "make this about X instead" must still fire when X/Y genuinely name a
// real occasion or subject-class keyword — the gate must narrow false
// positives without losing the real detections Part G's own examples
// require ("focus on weddings instead of birthdays").
test("detectExplicitConceptChangeRequest: 'focus on X instead of Y' still fires when X/Y name a real occasion/subject keyword", () => {
  const weddings = detectExplicitConceptChangeRequest("focus on weddings instead of birthdays");
  assert.equal(weddings.changed, true);
  assert.deepEqual(new Set(weddings.fields), new Set(["primarySubjectClass", "occasionCategory"]));

  const mascot = detectExplicitConceptChangeRequest("make this about our mascot instead");
  assert.equal(mascot.changed, true);
  assert.deepEqual(mascot.fields, ["primarySubjectClass"]);
});

test("detectExplicitConceptChangeRequest: 'change this from a birthday post to a sympathy post' is detected as a deliberate concept change", () => {
  const result = detectExplicitConceptChangeRequest("Change this from a birthday post to a sympathy post");
  assert.equal(result.changed, true);
  assert.ok(result.fields.includes("occasionCategory"));
  assert.ok(result.fields.includes("sympathyClassification"));
});

test("detectExplicitConceptChangeRequest: 'promote 20% off instead' is a deliberate objective/promotion change", () => {
  const result = detectExplicitConceptChangeRequest("Promote 20% off instead");
  assert.equal(result.changed, true);
  assert.ok(result.fields.includes("objective"));
  assert.ok(result.fields.includes("promotionIntent"));
});

test("detectExplicitConceptChangeRequest: 'remove the promotion and make it awareness-only' updates objective/promotion only", () => {
  const result = detectExplicitConceptChangeRequest("Remove the promotion and make it awareness-only");
  assert.equal(result.changed, true);
  assert.deepEqual(new Set(result.fields), new Set(["objective", "promotionIntent"]));
});

test("detectExplicitConceptChangeRequest: 'use inventory we have today' is an explicit inventory-intent change", () => {
  const result = detectExplicitConceptChangeRequest("use inventory we have today");
  assert.equal(result.changed, true);
  assert.deepEqual(result.fields, ["inventoryIntent"]);
});

test("detectExplicitConceptChangeRequest: 'change the cta to call us' updates CTA intent only", () => {
  const result = detectExplicitConceptChangeRequest("Change the CTA to call us");
  assert.equal(result.changed, true);
  assert.deepEqual(result.fields, ["ctaIntent"]);
});

// ---------------------------------------------------------------------------
// detectConceptDrift — Part I
// ---------------------------------------------------------------------------

test("detectConceptDrift: identical concepts never drift", () => {
  const concept = buildCanonicalConcept({ requestText: "x", objective: "awareness" });
  const result = detectConceptDrift(concept, { ...concept });
  assert.equal(result.hasDrift, false);
  assert.deepEqual(result.driftedFields, []);
});

test("detectConceptDrift: an unrequested objective change is caught when not in the allowed set", () => {
  const parent = buildCanonicalConcept({ requestText: "x", objective: "awareness" });
  const candidate = { ...parent, objective: "promotion" };
  const result = detectConceptDrift(parent, candidate, []);
  assert.equal(result.hasDrift, true);
  assert.deepEqual(result.driftedFields, ["objective"]);
});

test("detectConceptDrift: the SAME change is allowed when the field is in the allowed set (an explicit concept change)", () => {
  const parent = buildCanonicalConcept({ requestText: "x", objective: "awareness" });
  const candidate = { ...parent, objective: "promotion", promotionIntent: "real_promotion" };
  const result = detectConceptDrift(parent, candidate, ["objective", "promotionIntent"]);
  assert.equal(result.hasDrift, false);
});

test("detectConceptDrift: execution-detail fields (visualDirection, platform, factRequirements) never count as drift, even when they differ", () => {
  const parent = buildCanonicalConcept({ requestText: "x", creativeBrief: { lighting: "natural" }, platform: "facebook" });
  const candidate = { ...parent, visualDirection: { ...parent.visualDirection, lighting: "bright, sunlit" }, platform: "instagram", factRequirements: ["phone_number"] };
  const result = detectConceptDrift(parent, candidate, []);
  assert.equal(result.hasDrift, false);
});

test("detectConceptDrift: multiple simultaneous unrequested drifts are all reported, not just the first", () => {
  const parent = buildCanonicalConcept({ requestText: "x", objective: "awareness", isSympathy: false });
  const candidate = { ...parent, objective: "promotion", sympathyClassification: "sympathy" };
  const result = detectConceptDrift(parent, candidate, []);
  assert.equal(result.hasDrift, true);
  assert.deepEqual(new Set(result.driftedFields), new Set(["objective", "sympathyClassification"]));
});

// ---------------------------------------------------------------------------
// detectImageSubjectDrift — Part I #9
// ---------------------------------------------------------------------------

test("detectImageSubjectDrift: a prompt that still describes the same real subject is never flagged", () => {
  const reason = detectImageSubjectDrift({ primarySubject: "A jaguar mascot holding a bouquet of flowers", imagePromptText: "A bright photo of a jaguar mascot holding roses, natural light" });
  assert.equal(reason, null);
});

test("detectImageSubjectDrift: a prompt that shares NO real word with the canonical subject is flagged", () => {
  const reason = detectImageSubjectDrift({ primarySubject: "A jaguar mascot holding a bouquet of flowers", imagePromptText: "A calm negative-space floral backdrop, no subject, soft light" });
  assert.ok(reason);
  assert.match(reason, /no longer shares any real word/);
});

test("detectImageSubjectDrift: with no known subject yet, there is nothing to compare — never a false positive", () => {
  assert.equal(detectImageSubjectDrift({ primarySubject: null, imagePromptText: "anything" }), null);
  assert.equal(detectImageSubjectDrift({ primarySubject: "roses", imagePromptText: null }), null);
});
