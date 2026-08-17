import test from "node:test";
import assert from "node:assert/strict";
import {
  bloomEmptyState,
  bloomErrorState,
  bloomLoadingSkeleton,
  createGetCache,
  helpCopyForPage,
  onboardingProgress,
  parseProductImages,
  wrapApiWithCache,
  FLORIST_CHECKLIST
} from "../public/launch-polish-core.js";

test("helpCopyForPage returns navigation copy for known pages", () => {
  const orders = helpCopyForPage("ordersPage");
  assert.match(orders.title, /Orders/i);
  assert.match(orders.learn, /help/);
  const fallback = helpCopyForPage("unknownPage");
  assert.ok(fallback.body);
});

test("onboardingProgress tracks checklist completion", () => {
  const prog = onboardingProgress(FLORIST_CHECKLIST, ["shop", "inventory"]);
  assert.equal(prog.complete, 2);
  assert.equal(prog.total, FLORIST_CHECKLIST.length);
  assert.ok(prog.percent > 0);
  assert.ok(prog.remaining.every((s) => !["shop", "inventory"].includes(s.id)));
});

test("parseProductImages supports multiple urls and gallery fields", () => {
  const urls = parseProductImages({
    image_url: "https://example.com/a.jpg\nhttps://example.com/b.jpg",
    gallery_urls: ["https://example.com/c.jpg"]
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.includes("https://example.com/a.jpg"));
});

test("parseProductImages accepts site-relative photo paths, not just absolute http(s) URLs", () => {
  // Regression: a product added via Floral Library "Add to shop" can carry
  // a real, working local photo (public/assets/floral-library/...), but
  // the old http(s)-only check silently dropped it, so a real photo was
  // shown as a flower-emoji placeholder everywhere this is used (dashboard
  // Top Bouquets, Products grid, marketplace listings).
  const urls = parseProductImages({ image_url: "/assets/floral-library/funeral/fn-21-casket-spray-red-white-silver.jpg" });
  assert.deepEqual(urls, ["/assets/floral-library/funeral/fn-21-casket-spray-red-white-silver.jpg"]);
});

test("parseProductImages accepts data URIs and still drops garbage values", () => {
  const withDataUri = parseProductImages({ image_url: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(withDataUri.length, 1);
  const withGarbage = parseProductImages({ image_url: "not a real image reference" });
  assert.equal(withGarbage.length, 0);
});

test("empty and error states include accessible roles", () => {
  const empty = bloomEmptyState({ title: "No orders", message: "Create one to begin." });
  assert.match(empty, /role="status"/);
  const err = bloomErrorState({ message: "Network failed" });
  assert.match(err, /role="alert"/);
  assert.match(err, /Try again/);
});

test("loading skeleton exposes busy state for screen readers", () => {
  const html = bloomLoadingSkeleton("cards", 2);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /bloom-skeleton-card/);
});

test("GET api cache reduces duplicate fetches", async () => {
  let calls = 0;
  const api = async (path, opt = {}) => {
    calls += 1;
    return { path, ok: true };
  };
  const cache = createGetCache(5000);
  const wrapped = wrapApiWithCache(api, cache);
  await wrapped("settings");
  await wrapped("settings");
  assert.equal(calls, 1);
  await wrapped("orders", { method: "POST", body: "{}" });
  assert.equal(calls, 2);
  await wrapped("settings");
  assert.equal(calls, 3);
});

test("navigation help includes Lily entry point on dashboard", () => {
  const dash = helpCopyForPage("dashboardPage");
  assert.match(dash.body, /register|POS|order/i);
});
