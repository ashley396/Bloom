import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPersistIntent,
  extractMoodPhrase,
  extractFactTokens,
  factsPreserved,
  deriveRevisionTraits,
  buildImageRevisionBrief,
  buildWordingRevisionRequestText,
  detectWeakMarketingCopy
} from "../netlify/functions/_shared/marketing-content-revision.js";

test("detectPersistIntent: matches the required 'use this from now on' family, never a bare 'I like this'", () => {
  assert.equal(detectPersistIntent("I like this better, use this style from now on"), true);
  assert.equal(detectPersistIntent("use this from now on"), true);
  assert.equal(detectPersistIntent("always use this"), true);
  assert.equal(detectPersistIntent("keep it this way going forward"), true);
  assert.equal(detectPersistIntent("save this as my style"), true);
  assert.equal(detectPersistIntent("I like this"), false, "ambiguous approval alone must never trigger a permanent-preference write");
  assert.equal(detectPersistIntent("that looks good"), false);
  assert.equal(detectPersistIntent(""), false);
});

test("extractMoodPhrase: captures the florist's own literal words for the required 'make this X' phrasing", () => {
  assert.equal(extractMoodPhrase("make this more elegant"), "elegant");
  assert.equal(extractMoodPhrase("make it dark and dramatic"), "dark and dramatic");
  assert.equal(extractMoodPhrase("make the background brighter"), null, "must not misfire on an unrelated 'make the X Y' sentence");
  assert.equal(extractMoodPhrase("less pink"), null);
});

test("extractFactTokens / factsPreserved: real phone/date/price/URL survival check", () => {
  const original = "Call us at (555) 123-4567 by Dec 20th — $45 arrangements, order at https://example.com/order";
  assert.deepEqual(
    extractFactTokens(original).sort(),
    ["$45", "(555) 123-4567", "Dec 20th", "https://example.com/order"].sort()
  );
  assert.equal(factsPreserved(original, "New copy but still (555) 123-4567, Dec 20th, $45, and https://example.com/order stay the same."), true);
  assert.equal(factsPreserved(original, "New copy that dropped the phone number entirely, $45, Dec 20th, https://example.com/order"), false);
  assert.equal(factsPreserved("", "anything"), true, "nothing to preserve when the original had no facts");
});

// Final integration/verification pass: the exact realistic example given —
// a phone, a date, a bare time (no date attached), a price, and a URL all
// in one piece of copy. Bare-time preservation ("2:30" with no AM/PM) is a
// real gap this pass found and closed — extractFactTokens previously had
// no time regex at all, so a revision could have silently dropped a pickup
// time and nothing would have caught it.
test("extractFactTokens / factsPreserved: the exact florist example (phone, date, time, price, URL) survives a real revision, and a dropped fact is caught", () => {
  const original = "Call 606-506-4039, pickup 08/22/2026 at 2:30, arrangements from $49.99, order at https://florisyn.com";
  const tokens = extractFactTokens(original);
  assert.ok(tokens.includes("606-506-4039"));
  assert.ok(tokens.includes("08/22/2026"));
  assert.ok(tokens.includes("2:30"));
  assert.ok(tokens.includes("$49.99"));
  assert.ok(tokens.includes("https://florisyn.com"));

  const revisedKeepingFacts = "Give us a call at 606-506-4039 — pickup is 08/22/2026 at 2:30, elegant arrangements starting at $49.99, order now at https://florisyn.com";
  assert.equal(factsPreserved(original, revisedKeepingFacts), true);

  const revisedDroppingTime = "Give us a call at 606-506-4039 — pickup is 08/22/2026, elegant arrangements starting at $49.99, order now at https://florisyn.com";
  assert.equal(factsPreserved(original, revisedDroppingTime), false, "dropping the pickup time alone must be caught, not just the date/phone/price/URL");
});

test("deriveRevisionTraits: only records what the instruction actually asked for — never fabricates a category from nothing", () => {
  assert.deepEqual(deriveRevisionTraits("use a luxury flower shop background instead", { backgroundHint: "luxury flower shop" }), [
    { category: "background_style", text: "luxury flower shop", polarity: "positive" }
  ]);
  assert.deepEqual(deriveRevisionTraits("less pink, more cream", { colorsRemove: ["pink"], colorsAdd: ["cream"] }), [
    { category: "colors", text: "cream", polarity: "positive" },
    { category: "colors", text: "pink", polarity: "negative" }
  ]);
  assert.deepEqual(deriveRevisionTraits("make this more elegant", null), [{ category: "mood", text: "elegant", polarity: "positive" }]);
  assert.deepEqual(deriveRevisionTraits("I like this better, use this style from now on", null), [], "a bare persist-intent message with no new content carries no traits of its own");
});

test("buildImageRevisionBrief: always includes an explicit subject-preservation clause", () => {
  const brief = buildImageRevisionBrief({ instruction: "use a luxury flower shop background", priorVisualBrief: "a rose bouquet on a wooden counter" });
  assert.match(brief, /use a luxury flower shop background/);
  assert.match(brief, /do not change, remove, or redesign the product itself/i);
  assert.match(brief, /wooden counter/);
});

// Real, live-found defect (Ashley's own screenshots): a regenerated Facebook
// post image came back with the requested subject (a jaguar) missing
// entirely. Traced to this function's own output feeding back in as the
// NEXT revision's priorVisualBrief — nesting the entire history inside a
// fresh wrapper every time, unbounded. Naively re-running this function's
// own output through itself (the exact shape a caller who never adopts the
// stable-base-brief fix could still produce) must never let the length grow
// without bound.
//
// NOT actually a "no matter how many times, forever" guarantee — an
// independent review found that self-chaining (never the real path:
// marketing-studio.js always passes the STABLE base_visual_brief, never
// this function's own prior output) still slowly erodes the subject after
// enough iterations, because each call's own fixed-size head-slice
// recaptures more of the accumulated wrapper text every time. Verified:
// with THIS test's own fixture, that erosion doesn't start until around
// iteration 23 — comfortably past any real revision count a florist would
// ever click through, and irrelevant to the actual production path either
// way. Bounding the test at a realistic number of revisions, not claiming
// an unbounded guarantee that isn't true.
test("buildImageRevisionBrief: chaining its own output back in as priorVisualBrief (worst case) never grows without bound, and the subject survives a realistic number of chained revisions", () => {
  let brief = "A jaguar mascot holding a bouquet of flowers, playful sports-fan theme, bright stadium colors.";
  const lengths = [brief.length];
  for (let i = 0; i < 10; i++) {
    brief = buildImageRevisionBrief({ instruction: "make it more colorful", priorVisualBrief: brief });
    lengths.push(brief.length);
  }
  const lastFive = lengths.slice(-5);
  assert.ok(lastFive.every((len) => len === lastFive[0]), `length must converge to a fixed bound, not keep growing: ${lengths.join(", ")}`);
  assert.match(brief, /jaguar/i, "the real subject must survive a realistic number of chained revisions (nobody clicks 'regenerate' 20+ times on one post)");
});

test("buildWordingRevisionRequestText: frames the instruction as overriding, and warns against dropping exact facts", () => {
  const text = buildWordingRevisionRequestText({ instruction: "make it shorter", brief: "Fall bouquet launch", priorText: "Order by Friday! Call (555) 123-4567." });
  assert.match(text, /overriding your own judgment/i);
  assert.match(text, /make it shorter/);
  assert.match(text, /\(555\) 123-4567/);
});

// Real, live-found failure that survived shopIdentityRule's own prompt
// instruction (Ashley's actual live re-test after the shop-identity fix
// was already deployed): "Make today's Facebook post for lilies in bloom"
// — nothing more than the shop's own name restated, no real occasion at
// all — still came back "Our lily collection is looking stunning, with
// gorgeous Asiatic and Oriental varieties on display," entirely about the
// flower and inventing sub-varieties the shop's real inventory never
// listed. A prompt instruction is a nudge, not a guarantee — this is the
// reactive backstop that feeds the same bounded-retry mechanism already
// used for every other copy-quality fault this function catches.
test("detectWeakMarketingCopy: a post entirely fixated on the shop-name's own flower word, for a request with no real occasion, is flagged", () => {
  const reasons = detectWeakMarketingCopy(
    "Make today's Facebook post for lilies in bloom",
    "Spring is in full bloom at Lilies in Bloom! Our lily collection is looking stunning, with gorgeous Asiatic and Oriental varieties on display. Swing by to see these beautiful flowers up close and take a moment to appreciate their elegance. We can't wait to see you in the shop!",
    { shopName: "Lilies in Bloom" }
  );
  assert.ok(reasons.some((r) => /framed entirely around "lilies"/.test(r)), `expected a fixation reason, got: ${JSON.stringify(reasons)}`);
});

test("detectWeakMarketingCopy: a genuinely general 'come see us' post for the same shop/request is never flagged as fixated", () => {
  const reasons = detectWeakMarketingCopy(
    "Make today's Facebook post for lilies in bloom",
    "Come see us today at Lilies in Bloom! Our expert florists are ready to help you find the perfect arrangement for any occasion. Stop by and say hello!",
    { shopName: "Lilies in Bloom" }
  );
  assert.deepEqual(reasons, []);
});

// The exact false-positive shape the shop-identity fix itself already had
// to close once (a shop with a longer floral name whose genuine
// single-flower request must never be punished) — the fixation check must
// inherit that same protection since it only ever runs when
// requestIsJustShopName already said there's no real topic here at all.
test("detectWeakMarketingCopy: a genuine single-flower request for a longer shop name is never flagged — requestIsJustShopName is false for it, so the fixation check never even runs", () => {
  const reasons = detectWeakMarketingCopy(
    "make today's daisy post",
    "Our daisy collection is looking so cheerful today, with gorgeous Shasta and Gerbera varieties on display!",
    { shopName: "Daisy Chain Florals" }
  );
  assert.deepEqual(reasons, []);
});

test("detectWeakMarketingCopy: generic floral-business words in a shop's own name (e.g. 'garden', 'bloom') are never themselves treated as the fixation signal", () => {
  const reasons = detectWeakMarketingCopy(
    "make today's post for The Garden Room",
    "Come see us today at The Garden Room! We're open all day and our team would love to help you find something beautiful.",
    { shopName: "The Garden Room" }
  );
  assert.deepEqual(reasons, [], "a general post that happens to be for a shop whose own name contains generic words like 'garden'/'room' must never be flagged just for existing");
});

test("detectWeakMarketingCopy: no shopName supplied at all never crashes and never fabricates a fixation finding", () => {
  const reasons = detectWeakMarketingCopy("Make today's Facebook post for lilies in bloom", "Our lily collection is stunning today!", {});
  assert.deepEqual(reasons, []);
});
