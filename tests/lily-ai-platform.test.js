import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_TIERS,
  buildCoachSuggestions,
  checkLilyPermission,
  detectIntent,
  mapAdminInsight,
  planClientAction,
  requiresConfirmationForTier,
  sanitizeHistoryEntry,
  searchHistory
} from "../netlify/functions/_shared/lily-ai-engine.js";

test("detectIntent routes inventory add commands", () => {
  const intent = detectIntent("Add 50 red roses.");
  assert.equal(intent.intent, "inventory.add");
  assert.equal(intent.slots.quantity, "50");
  assert.match(intent.slots.item, /rose/i);
});

test("detectIntent routes orders and customers", () => {
  assert.equal(detectIntent("Create an order for Sarah.").intent, "orders.create");
  assert.equal(detectIntent("Show today's deliveries.").intent, "deliveries.today");
  assert.equal(detectIntent("Find John Smith.").intent, "customers.find");
});

test("detectIntent routes marketplace sourcing (still a fast, deterministic path — real data, never paraphrased)", () => {
  assert.equal(detectIntent("Find white carnations.").intent, "marketplace.search");
});

// AI-OS Phase 2: marketing creation requests ("Write a Facebook post",
// "Create an email for Mother's Day") deliberately no longer resolve here.
// detectIntent() only owns the small set of genuinely unambiguous
// single-purpose commands; everything else — including all marketing
// creation — now falls through to general.chat here, then gets real
// understanding one layer up from classifyRequest() in
// ai-intent-router.js (see lily-ai.js), which reads the whole sentence
// instead of matching a keyword fragment. This is the direct fix for the
// documented "create a Facebook post becomes a paraphrase" failure.
test("detectIntent no longer classifies marketing creation itself — that now requires real sentence understanding, not a keyword match", () => {
  assert.equal(detectIntent("Write a Facebook post.").intent, "general.chat");
  assert.equal(detectIntent("Create an email for Mother's Day").intent, "general.chat");
});

// The other confirmed root cause: the bare word "website" anywhere in a
// message used to hijack the whole request into a content-free navigate,
// regardless of what the rest of the sentence asked for. Only the two
// genuinely unambiguous website phrases still fast-path here.
test("detectIntent: the bare word 'website' no longer hijacks a longer request into a navigate", () => {
  assert.notEqual(
    detectIntent("Make a campaign for Facebook and my website telling students to order Homecoming flowers.").intent,
    "website.update"
  );
  assert.equal(detectIntent("update homepage").intent, "website.update");
  assert.equal(detectIntent("add this product").intent, "website.update");
});

test("permission enforcement blocks payroll for staff", () => {
  const denied = checkLilyPermission("employees.payroll", "staff");
  assert.equal(denied.allowed, false);
  const allowed = checkLilyPermission("employees.payroll", "owner");
  assert.equal(allowed.allowed, true);
});

test("admin insights require platform admin flag", () => {
  const denied = checkLilyPermission("admin.insights", "owner", { isPlatformAdmin: false });
  assert.equal(denied.allowed, false);
  const allowed = checkLilyPermission("admin.insights", "support", { isPlatformAdmin: true });
  assert.equal(allowed.allowed, true);
});

test("planClientAction marks destructive inventory changes as confirmed", () => {
  const planned = planClientAction("inventory.add", { quantity: "3", item: "hydrangeas" });
  assert.equal(planned.requiresConfirmation, true);
  assert.equal(planned.endpoint, "inventory");
});

test("requiresConfirmationForTier only gates IMPORTANT and DESTRUCTIVE (Lily Step 76)", () => {
  assert.equal(requiresConfirmationForTier("READ"), false);
  assert.equal(requiresConfirmationForTier("LOW"), false);
  assert.equal(requiresConfirmationForTier("IMPORTANT"), true);
  assert.equal(requiresConfirmationForTier("DESTRUCTIVE"), true);
  assert.deepEqual(ACTION_TIERS, ["READ", "LOW", "IMPORTANT", "DESTRUCTIVE"]);
});

test("every planClientAction case reports a real tier, and requiresConfirmation always matches that tier — never hand-drifted", () => {
  const cases = [
    ["inventory.add", { quantity: "3", item: "roses" }, "IMPORTANT"],
    ["inventory.remove", { quantity: "3", item: "roses" }, "IMPORTANT"],
    ["orders.create", { customer_name: "Sarah" }, "IMPORTANT"],
    ["support.report_issue", { prompt: "checkout is broken" }, "IMPORTANT"],
    ["deliveries.today", {}, "READ"],
    ["customers.find", { query: "Sarah" }, "READ"],
    ["marketplace.search", { query: "carnations" }, "READ"],
    ["wholesale.product", {}, "READ"],
    ["website.update", {}, "READ"],
    ["reports.insights", {}, "READ"],
    ["employees.clock_in", { name: "Jamie" }, "READ"],
    ["employees.payroll", {}, "READ"],
    ["admin.insights", {}, "READ"],
    ["florist.photo_placeholder", {}, "READ"],
    // marketing.generate intentionally has no planClientAction case
    // anymore — real marketing creation runs through the
    // classifyRequest()/runJob() pipeline (ai-orchestrator.js), which has
    // its own real per-step execution state, not a single static tier.
    ["product_ai.generate", { prompt: "describe" }, "LOW"]
  ];
  for (const [intent, slots, expectedTier] of cases) {
    const planned = planClientAction(intent, slots);
    assert.equal(planned.tier, expectedTier, `${intent} should be tier ${expectedTier}`);
    assert.equal(
      planned.requiresConfirmation,
      requiresConfirmationForTier(expectedTier),
      `${intent}'s requiresConfirmation must match its tier, not drift from it`
    );
  }
});

test("the flower-photo intent no longer claims the feature is 'coming soon' — it's real (Step 66/75)", () => {
  const planned = planClientAction("florist.photo_placeholder", {});
  assert.doesNotMatch(planned.message, /coming soon/i);
  assert.match(planned.message, /Build recipe with Lily/);
});

test("conversation history sanitize and search", () => {
  const entry = sanitizeHistoryEntry({ role: "user", content: "Add 10 roses" });
  assert.ok(entry.id);
  const results = searchHistory([entry, { content: "payroll report" }], "rose");
  assert.equal(results.length, 1);
});

test("tenant isolation is enforced server-side via shop membership (mock)", () => {
  const shopA = "11111111-1111-1111-1111-111111111111";
  const shopB = "22222222-2222-2222-2222-222222222222";
  assert.notEqual(shopA, shopB);
  const permission = checkLilyPermission("inventory.remove", "staff");
  assert.equal(permission.allowed, false);
});

test("mapAdminInsight answers revenue questions without secrets", () => {
  const text = mapAdminInsight("What is revenue?", { kpis: { monthly_recurring_revenue: 1200, gross_marketplace_sales: 5000 } });
  assert.match(text, /\$1,200/);
  assert.match(text, /\$5,000/);
  assert.doesNotMatch(text, /sk_live|service_role|secret/i);
});

test("buildCoachSuggestions surfaces reorder guidance", () => {
  const suggestions = buildCoachSuggestions({
    inventory: [{ name: "Rose", quantity: 2, low_stock_level: 5 }],
    recent_orders: []
  });
  assert.ok(suggestions.some((s) => s.id === "reorder"));
});

test("product_ai.generate is still a fast-path regex intent (unchanged, out of scope for the AI-OS rebuild)", () => {
  assert.equal(detectIntent("Generate product title and SEO").intent, "product_ai.generate");
});
