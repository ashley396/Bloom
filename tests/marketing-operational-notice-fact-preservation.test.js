/**
 * Test F: operational-time + status fact-preservation fix.
 *
 * Live failure this closes: the exact browser prompt "Let customers know
 * we will be closing at 2 PM today." dropped "2 PM" entirely and rewrote
 * "closing" as "closed" — misstating Lilies in Bloom as closed all day
 * rather than open until 2 PM. Root cause: TIME_RE required a colon
 * (H:MM), so a bare-hour time ("2 PM", "9 AM", "10PM") was never
 * recognized as a time at all.
 *
 * This file locks in: (1) every bare-hour/colon time format Ashley listed
 * survives, (2) the 8-phrasing regression matrix produces 8 genuinely
 * DISTINCT results — none of Ashley's negative/rejection phrasings ever
 * collide with the exact Test F contract, (3) a notice with no supplied
 * time never acquires one, and (4) the exact live-failed prompt now
 * produces the required deterministic result end to end through the real
 * handler.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicNoticeContent,
  classifyOperationalNoticeFacts,
  detectMissingOperationalNoticeFacts,
  detectUnsupportedOperationalNoticeClaims
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";

function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}

// ---------------------------------------------------------------------------
// Part 1: bare-hour and colon time formats, every one Ashley listed.
// ---------------------------------------------------------------------------

test("Part 1: every listed time format is recognized (never a special-cased literal)", () => {
  const formats = ["2 PM", "2PM", "2 pm", "9 AM", "9AM", "10 PM", "10:00 PM", "2:30 PM"];
  for (const time of formats) {
    const out = buildDeterministicNoticeContent({ requestText: `We will be closing at ${time} today.`, shopName: SHOP, shopPhone: PHONE });
    assert.ok(out, `expected a notice for "${time}"`);
    assert.ok(out.body.includes(time), `expected the exact time "${time}" to survive verbatim in "${out.body}"`);
    assert.equal(out.headline, "Closing Early Today", `expected a Closing Early headline for "${time}"`);
  }
});

test("Part 1: the contract itself extracts every listed time format", () => {
  const formats = ["2 PM", "2PM", "2 pm", "9 AM", "9AM", "10 PM", "10:00 PM", "2:30 PM"];
  for (const time of formats) {
    const contract = classifyOperationalNoticeFacts(`We will be closing at ${time} today.`);
    assert.ok(contract, `expected a contract for "${time}"`);
    assert.equal(contract.time, time, `expected classifyOperationalNoticeFacts to extract "${time}" verbatim`);
  }
});

// ---------------------------------------------------------------------------
// Part 2/5: the 8-phrasing distinctness matrix.
// ---------------------------------------------------------------------------

test("Part 2/5: the 8 required phrasings produce 8 genuinely distinct results", () => {
  const cases = [
    { text: "We will be closing at 2 PM today.", headline: "Closing Early Today", bodyRe: /closing at 2 PM today/ },
    { text: "We will be closing at 2PM today.", headline: "Closing Early Today", bodyRe: /closing at 2PM today/ },
    { text: "We will be closing at 2:30 PM today.", headline: "Closing Early Today", bodyRe: /closing at 2:30 PM today/ },
    { text: "We will be closing at 10 AM today.", headline: "Closing Early Today", bodyRe: /closing at 10 AM today/ },
    { text: "We are closed today.", headline: "Closed Today", bodyRe: /is closed today/ },
    { text: "We will open at 2 PM today.", headline: "Opening Today", bodyRe: /opening at 2 PM today/ },
    { text: "We will be opening late at 10 AM today.", headline: "Opening Late Today", bodyRe: /opening at 10 AM today/ },
    { text: "We will close at 5:30 PM Friday.", headline: "Closing Early Friday", bodyRe: /closing at 5:30 PM Friday/ }
  ];
  const seen = new Set();
  for (const c of cases) {
    const out = buildDeterministicNoticeContent({ requestText: c.text, shopName: SHOP, shopPhone: PHONE });
    assert.ok(out, `expected a notice for "${c.text}"`);
    assert.equal(out.headline, c.headline, `headline for "${c.text}"`);
    assert.match(out.body, c.bodyRe, `body for "${c.text}"`);
    const key = `${out.headline}|${out.body}`;
    assert.ok(!seen.has(key), `"${c.text}" collided with an earlier phrasing's result: ${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, cases.length, "all 8 phrasings must be pairwise distinct");
});

// ---------------------------------------------------------------------------
// Part 2/5: the exact Test F contract and its required negative cases.
// ---------------------------------------------------------------------------

const EXACT_TEST_F_PROMPT = "Let customers know we will be closing at 2 PM today.";

test("Part 4: the exact Test F prompt produces the required deterministic result", () => {
  const out = buildDeterministicNoticeContent({ requestText: EXACT_TEST_F_PROMPT, shopName: SHOP, shopPhone: PHONE });
  assert.ok(out);
  assert.equal(out.headline, "Closing Early Today");
  assert.equal(out.body, "Lilies in Bloom is closing at 2 PM today.");
  assert.equal(out.caption, "Lilies in Bloom is closing at 2 PM today.");
  // Part 6: the request never asked for a CTA — no phone typed, no
  // order/contact language — so no CTA must be invented, even though a
  // verified phone number exists on file.
  assert.equal(out.cta, "", "a plain closing notice with no contact/order signal must never invent a CTA");
});

test("Part 5: 'Closed Today' explicitly FAILS the exact Test F contract — the two must never collide", () => {
  const wanted = buildDeterministicNoticeContent({ requestText: EXACT_TEST_F_PROMPT, shopName: SHOP, shopPhone: PHONE });
  const rejects = [
    "Closed Today",
    "Closing at 3 PM Today",
    "Closing Early Today",
    "We'll reopen tomorrow",
    "Closing at 2 PM for a funeral"
  ];
  // The contract-level check: none of these phrasings, run through the
  // SAME builder, produce the exact Test F headline+body pair.
  for (const bad of rejects) {
    const out = buildDeterministicNoticeContent({ requestText: bad, shopName: SHOP, shopPhone: PHONE });
    const key = out ? `${out.headline}|${out.body}` : null;
    assert.notEqual(key, `${wanted.headline}|${wanted.body}`, `"${bad}" must never produce the exact Test F result`);
  }
});

test("Part 5: existing operational notices with NO supplied time remain valid and never acquire one", () => {
  const out = buildDeterministicNoticeContent({ requestText: "We are closed today.", shopName: SHOP, shopPhone: PHONE });
  assert.ok(out);
  assert.equal(out.headline, "Closed Today");
  assert.doesNotMatch(out.body, /\d{1,2}(:\d{2})?\s*(am|pm)/i, "no time must be invented when none was supplied");
});

// Independent-review finding: widening the bare "close" verb form to catch
// "We will close at 5:30 PM Friday." must never also match the unrelated
// ADJECTIVE sense of "close" ("close to selling out," "close by") — a
// wholly ordinary promotional post was misclassified as an operational
// closing notice purely because "close" and a day word both appeared in
// the sentence, which would then push a true, everyday caption through
// the operational-notice detectors and risk a spurious rejection.
test("Part 1 regression: the adjective sense of 'close' is never read as a closing notice", () => {
  assert.equal(
    classifyOperationalNoticeFacts("We are close to selling out on peonies today, order now!"),
    null,
    "'close to' is the adjective sense (nearly out of stock), never an operational closing signal"
  );
  assert.equal(
    classifyOperationalNoticeFacts("We are close by if you need anything today."),
    null,
    "'close by' is the adjective sense (nearby), never an operational closing signal"
  );
  // The actual safety property: with no operational-notice contract, the
  // independent evaluator (detectUnsupportedOperationalNoticeClaims) never
  // fires on an ordinary promotional caption just because it happens to
  // contain "close" and a day word.
  assert.deepEqual(
    detectUnsupportedOperationalNoticeClaims({
      generatedText: "Peonies are almost gone — stop by while we are still open today!",
      requestText: "We are close to selling out on peonies today, order now!",
      operationalNoticeFacts: classifyOperationalNoticeFacts("We are close to selling out on peonies today, order now!")
    }),
    [],
    "an ordinary promotional caption must never be rejected as an operational-notice violation"
  );
  // The verb sense must still work exactly as before.
  const verb = classifyOperationalNoticeFacts("We will close at 5:30 PM Friday.");
  assert.equal(verb?.operation, "closing");
  assert.equal(verb?.time, "5:30 PM");
});

// ---------------------------------------------------------------------------
// Part 3: the independent evaluator (defense in depth).
// ---------------------------------------------------------------------------

test("Part 3: detectMissingOperationalNoticeFacts flags a dropped or altered time", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  assert.equal(facts.time, "2 PM");
  assert.deepEqual(
    detectMissingOperationalNoticeFacts({ generatedText: "Lilies in Bloom is closed today.", operationalNoticeFacts: facts }).map((e) => e.code),
    ["operational_time_missing"]
  );
  assert.deepEqual(
    detectMissingOperationalNoticeFacts({ generatedText: "Lilies in Bloom is closing at 3 PM today.", operationalNoticeFacts: facts }).map((e) => e.code),
    ["operational_time_altered"]
  );
  assert.deepEqual(
    detectMissingOperationalNoticeFacts({ generatedText: "Lilies in Bloom is closing at 2 PM today.", operationalNoticeFacts: facts }),
    []
  );
});

test("Part 3: detectMissingOperationalNoticeFacts flags a dropped day/date reference", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  assert.deepEqual(
    detectMissingOperationalNoticeFacts({ generatedText: "Lilies in Bloom is closing at 2 PM.", operationalNoticeFacts: facts }).map((e) => e.code),
    ["operational_day_missing"]
  );
});

test("Part 3: detectUnsupportedOperationalNoticeClaims catches closing rewritten as closed", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  assert.equal(facts.operation, "closing");
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is closed today.",
    requestText: EXACT_TEST_F_PROMPT,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.ok(codes.includes("operational_status_altered_to_closed"), codes.join(","));
});

test("Part 3: detectUnsupportedOperationalNoticeClaims catches closing rewritten as opening", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is opening at 2 PM today.",
    requestText: EXACT_TEST_F_PROMPT,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.ok(codes.includes("operational_status_altered_to_opening"), codes.join(","));
});

test("Part 3: detectUnsupportedOperationalNoticeClaims catches an invented reopening promise", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is closing at 2 PM today. We'll reopen tomorrow!",
    requestText: EXACT_TEST_F_PROMPT,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.ok(codes.includes("operational_reopening_invented"), codes.join(","));
});

test("Part 3: detectUnsupportedOperationalNoticeClaims catches an invented closing reason", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is closing at 2 PM today for a funeral.",
    requestText: EXACT_TEST_F_PROMPT,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.ok(codes.includes("operational_reason_invented"), codes.join(","));
});

test("Part 3: detectUnsupportedOperationalNoticeClaims allows a reason the florist actually supplied", () => {
  const requestText = "We will be closing at 2 PM today for a family emergency.";
  const facts = classifyOperationalNoticeFacts(requestText);
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is closing at 2 PM today for a family emergency.",
    requestText,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.deepEqual(codes, [], "a reason the florist genuinely supplied must never be flagged");
});

test("Part 3: detectUnsupportedOperationalNoticeClaims catches invented new store hours", () => {
  const facts = classifyOperationalNoticeFacts(EXACT_TEST_F_PROMPT);
  const codes = detectUnsupportedOperationalNoticeClaims({
    generatedText: "Lilies in Bloom is closing at 2 PM today. Our new hours are 9 to 5.",
    requestText: EXACT_TEST_F_PROMPT,
    operationalNoticeFacts: facts
  }).map((e) => e.code);
  assert.ok(codes.includes("operational_hours_invented"), codes.join(","));
});

// ---------------------------------------------------------------------------
// Part 6: the CTA must never solicit orders a plain notice never asked for.
// ---------------------------------------------------------------------------

test("Part 6: a plain closing notice never inherits call/order CTA behavior just because a phone exists on file", () => {
  const out = buildDeterministicNoticeContent({ requestText: EXACT_TEST_F_PROMPT, shopName: SHOP, shopPhone: PHONE });
  assert.equal(out.cta, "");
  assert.doesNotMatch(out.caption, /place an order|call \d/i, "no ordering solicitation must appear anywhere in the caption");
});

test("Part 6: a request that itself asks for contact still gets an honest, non-order CTA", () => {
  const out = buildDeterministicNoticeContent({ requestText: "We will be closing at 2 PM today. Call with any questions.", shopName: SHOP, shopPhone: PHONE });
  assert.equal(out.cta, `Call ${PHONE}.`);
  assert.doesNotMatch(out.cta, /place an order/i, "no order language must be invented when the request never used it");
});

// ---------------------------------------------------------------------------
// Real-handler reproduction of the exact live-failed prompt.
// ---------------------------------------------------------------------------

test("real dispatch: the exact live-failed Test F prompt now produces the required result end to end", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const fetchCalls = [];
  try {
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "image_post", title: "Closing notice", brief: EXACT_TEST_F_PROMPT, status: "idea" }, error: null }, // currentItem
        { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
        { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
        { data: { marketing_monthly_budget_cents: null }, error: null }, // budget check
        { data: { name: SHOP, phone: PHONE }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience customers
        { data: [], error: null }, // audience orders
        { data: [], error: null }, // recent-content shortlist
        { data: null, error: null }, // recordUsage("copy")
        { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image)
        { data: null, error: null }, // completeProviderCall(image)
        { data: { id: "usage-vision-1" }, error: null }, // reserveProviderCall(vision)
        { data: null, error: null }, // completeProviderCall(vision)
        { data: { id: "flyer-asset-1" }, error: null }, // persistGeneratedAsset (flyer)
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
      ],
      { storage: createFakeSupabaseStorage({}) }
    );
    globalThis.fetch = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if ("image" in body) {
        // The vision quality-check call — a real, well-formed PASS reply.
        return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean, matches the brief" } }) };
      }
      fetchCalls.push({ url: String(url), body });
      if (String(url).includes("black-forest-labs") || "prompt" in body) {
        return { ok: true, json: async () => ({ success: true, result: { image: "ZmFrZS1pbWFnZS1ieXRlcw==" } }) };
      }
      return { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) };
    };
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const content = assetInsert.ops.find((op) => op[0] === "insert")[1][0].content;
    assert.equal(content.headline, "Closing Early Today");
    assert.equal(content.body, "Lilies in Bloom is closing at 2 PM today.");
    assert.equal(content.cta, "", "no CTA must be invented for this exact prompt");
    assert.equal(content.caption, "Lilies in Bloom is closing at 2 PM today.");
    // No wording provider call — this is the deterministic path.
    const textCalls = fetchCalls.filter((c) => !(c.url.includes("black-forest-labs") || "prompt" in c.body));
    assert.equal(textCalls.length, 0, "the AI wording model must never be called for this deterministic notice");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
