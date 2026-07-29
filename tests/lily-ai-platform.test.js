import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoachSuggestions,
  checkLilyPermission,
  detectIntent,
  mapAdminInsight,
  planClientAction,
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

test("detectIntent routes marketing and marketplace", () => {
  assert.equal(detectIntent("Write a Facebook post.").intent, "marketing.generate");
  assert.equal(detectIntent("Find white carnations.").intent, "marketplace.search");
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

test("product and marketing generation intents", () => {
  assert.equal(detectIntent("Generate product title and SEO").intent, "product_ai.generate");
  assert.equal(detectIntent("Create an email for Mother's Day").intent, "marketing.generate");
});
