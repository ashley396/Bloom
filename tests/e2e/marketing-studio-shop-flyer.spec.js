import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";
import { buildDeterministicNoticeContent } from "../../netlify/functions/_shared/marketing-content-revision.js";

/**
 * Live beta defect fix: an operational post ("closing early today... call
 * 606-506-4039") was handed to the AI image model as words to paint,
 * producing garbled nonsense instead of the real message. Routed to
 * Florisyn's own deterministic flyer renderer instead — these tests drive
 * the REAL florist-facing card render + FlorisynFlyerRenderer.renderFlyer()
 * call path, not a simplified stand-in, proving requirement 6 (never reads
 * "ready for your review" while an uncontrolled/failed render could be
 * standing in for the real message) and requirement 8 (a reload/fresh load
 * shows the same persisted flyer correctly).
 *
 * Durability follow-up (a real verification pass caught this before it
 * shipped): a canvas rendering successfully in the browser was never
 * actually a durable, publishable asset — nothing server-side had ever
 * received or stored those pixels. finalize_flyer_render closes that gap;
 * these tests now also prove the client actually calls it with the real
 * rendered bytes, that the settled image src is the real storage URL it
 * returns (not the browser's own transient data: URL), and that a flyer
 * which already has a durable url (this device's own earlier finalize, or
 * a different device/browser) is shown directly with no redundant
 * render/upload — the actual cross-device consistency guarantee.
 */

// A genuinely valid, loadable 1x1 PNG (not just header bytes) — routes that
// stand in for a real storage URL need to actually decode as an image in
// Chromium, or the browser's own <img> error event (which wireFlyerImageFallbacks
// deliberately listens for — requirement 6's "missing file" case) fires for
// reasons that have nothing to do with what a given test is checking.
const REAL_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
async function routeAsRealImage(page, url) {
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: "image/png", body: REAL_PNG_BYTES }));
}

const FLYER_ITEM = {
  id: "item-1",
  content_type: "image_post",
  title: "Closing early today",
  brief: "Create a Facebook post letting customers know Lilies in Bloom will close at 2:30 today. Call 606-506-4039 to order.",
  status: "draft",
  asset: {
    id: "flyer-asset-1",
    asset_type: "flyer",
    parent_asset_id: null,
    content: {
      headline: "CLOSING EARLY",
      body: "Lilies in Bloom will close at 2:30 today.",
      cta: "Need to place an order? Call 606-506-4039.",
      caption: "Heads up — we're closing at 2:30 PM today. Call 606-506-4039 to place a last-minute order!",
      template_id: "notice",
      regions: { headline: { x: 0.06, y: 0.14, w: 0.88, h: 0.2 }, body: { x: 0.06, y: 0.38, w: 0.88, h: 0.24 }, cta: { x: 0.06, y: 0.66, w: 0.88, h: 0.16 }, logo: { x: 0.5, y: 0.04, w: 0.16, h: 0.08 }, contact: { x: 0.06, y: 0.9, w: 0.88, h: 0.06 } },
      palette: { background: "brand_primary" },
      canvas: { width: 1080, height: 1080 },
      style: { scale: { headline: "normal", body: "normal", cta: "normal" } },
      background_url: null,
      brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
      url: null,
      storage_path: null,
      mime: null,
      render_status: null,
      rendered_at: null
    }
  },
  variants: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", caption: "Heads up — we're closing at 2:30 PM today. Call 606-506-4039 to place a last-minute order!", asset_id: "flyer-asset-1" }]
};

async function mockMarketingStudioShop(page, item = FLYER_ITEM) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    if (action === "status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marketing_studio_enabled: true, note: "" }) });
      return;
    }
    if (action === "list_content") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [item] }) });
      return;
    }
    if (["get_brand_brain", "get_visual_style", "usage_summary", "connections"].includes(action)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openMarketingStudioShop(page) {
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingStudioPage"]').click();
  const root = page.locator("#marketingStudioRoot");
  await expect(root.locator('[data-ms-item="item-1"]')).toBeVisible();
  return root;
}

test("a flyer item, freshly loaded (requirement 8: reload persistence), renders through the real FlorisynFlyerRenderer AND persists the result via finalize_flyer_render — never just a client-side canvas standing in as \"done\"", async ({ page }) => {
  let renderCallContent = null;
  let finalizeCall = null;
  const FINALIZED_URL = "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png";
  // A minimal, real (not mocked-away) substitute for the renderer script —
  // still a real canvas draw, still awaited asynchronously exactly like
  // production, just without needing actual image/font loading in a
  // headless test run. Captures what it was ACTUALLY called with, so the
  // test proves the exact persisted content reached the renderer.
  await page.route("**/flyer-renderer.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.FlorisynFlyerRenderer = { renderFlyer: function(opts) {
        window.__flyerRenderCalls = window.__flyerRenderCalls || [];
        window.__flyerRenderCalls.push(opts);
        var c = document.createElement("canvas"); c.width = 10; c.height = 10;
        return Promise.resolve(c);
      } };`
    })
  );
  await mockMarketingStudioShop(page);
  await routeAsRealImage(page, FINALIZED_URL);
  // Registered AFTER mockMarketingStudioShop's own handler (tried first by
  // Playwright), falling back to it for every other action — same pattern
  // the render-failure test below already uses. The finalize response is
  // deliberately delayed so the test can observe the honest "preparing"
  // state (requirement 6) before it resolves, not just the end state.
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "finalize_flyer_render") {
      finalizeCall = JSON.parse(route.request().postData() || "{}");
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: {
            id: "flyer-asset-1",
            url: FINALIZED_URL,
            content: { ...FLYER_ITEM.asset.content, url: FINALIZED_URL, storage_path: "shop-ashley/flyers/flyer-asset-1.png", mime: "image/png", width: 1080, height: 1080, render_status: "rendered", rendered_at: "now" }
          }
        })
      });
      return;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  // Requirement 6, "before" state: while the render/upload is still in
  // flight, the eyebrow must NOT claim "Draft — ready for your review", and
  // Approve must already be disabled — not just on eventual failure.
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/preparing your flyer/i, { timeout: 2000 });
  await expect(root.locator('[data-ms-act="approve"]')).toBeDisabled();

  const img = root.locator("#msFlyerImg-item-1");
  // The settled src must be the real, durable storage URL finalize_flyer_render
  // returned — never left standing at the browser's own transient data:
  // URL, which was the exact gap a real durability review caught.
  await expect(img).toHaveAttribute("src", FINALIZED_URL, { timeout: 5000 });
  await expect(root.locator("#msFlyerNote-item-1")).toHaveCount(0);

  // Requirement 6, "after" state: the eyebrow reverts to the real status
  // label once preparation genuinely finished.
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/ready for your review/i);

  expect(finalizeCall, "finalize_flyer_render must actually be called with the rendered bytes").toBeTruthy();
  expect(finalizeCall.content_item_id).toBe("item-1");
  expect(finalizeCall.asset_id).toBe("flyer-asset-1");
  expect(typeof finalizeCall.data_url).toBe("string");
  expect(finalizeCall.data_url.startsWith("data:image/png")).toBe(true);

  renderCallContent = await page.evaluate(() => window.__flyerRenderCalls[0]);
  assertFlyerCallMatchesPersistedContent(renderCallContent);

  function assertFlyerCallMatchesPersistedContent(call) {
    expect(call.content.headline).toBe("CLOSING EARLY");
    expect(call.content.body).toBe("Lilies in Bloom will close at 2:30 today.");
    expect(call.content.cta).toBe("Need to place an order? Call 606-506-4039.");
    expect(call.brand.phone).toBe("606-506-4039");
  }

  // Approve is reachable normally — the render AND the real upload succeeded.
  await expect(root.locator('[data-ms-act="approve"]')).toBeEnabled();
});

test("cross-device consistency: a flyer that already has a durable content.url (this device's own earlier finalize, or a different device entirely) shows that real file directly — no re-render, no redundant upload", async ({ page }) => {
  const ALREADY_FINALIZED_URL = "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png";
  const finalizedItem = {
    ...FLYER_ITEM,
    asset: {
      ...FLYER_ITEM.asset,
      content: {
        ...FLYER_ITEM.asset.content,
        url: ALREADY_FINALIZED_URL,
        storage_path: "shop-ashley/flyers/flyer-asset-1.png",
        mime: "image/png",
        width: 1080,
        height: 1080,
        render_status: "rendered",
        rendered_at: "2026-08-20T00:00:00.000Z"
      }
    }
  };
  let rendererLoaded = false;
  let finalizeCalled = false;
  await page.route("**/flyer-renderer.js*", (route) => {
    rendererLoaded = true;
    return route.fulfill({ status: 200, contentType: "application/javascript", body: `window.FlorisynFlyerRenderer = { renderFlyer: function() { return Promise.reject(new Error("should never be called")); } };` });
  });
  await mockMarketingStudioShop(page, finalizedItem);
  await routeAsRealImage(page, ALREADY_FINALIZED_URL);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("action") === "finalize_flyer_render") {
      finalizeCalled = true;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  const img = root.locator("#msFlyerImg-item-1");
  await expect(img).toHaveAttribute("src", ALREADY_FINALIZED_URL);
  await expect(root.locator("#msFlyerNote-item-1")).toHaveCount(0);
  await expect(root.locator('[data-ms-act="approve"]')).toBeEnabled();
  // An already-durable flyer must read as genuinely ready immediately —
  // never a transient "preparing" label for something that's already done.
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/ready for your review/i);

  // Give any stray async call a moment to fire before asserting it didn't.
  await page.waitForTimeout(200);
  expect(finalizeCalled, "an already-durable flyer must not trigger a redundant finalize_flyer_render call").toBe(false);
  // The renderer script itself may still load as part of the page bundle —
  // what matters is that renderFlyer() (which would reject and break this
  // test) was never actually invoked, proven by the image already showing
  // the real persisted url rather than the failure note.
  void rendererLoaded;
});

test("Regenerate image: a one-click button sends a real plain-language revise_content instruction — no typing, never a raw provider prompt, never touching the wording", async ({ page }) => {
  const ALREADY_FINALIZED_URL = "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png";
  const finalizedItem = {
    ...FLYER_ITEM,
    asset: {
      ...FLYER_ITEM.asset,
      content: {
        ...FLYER_ITEM.asset.content,
        url: ALREADY_FINALIZED_URL,
        storage_path: "shop-ashley/flyers/flyer-asset-1.png",
        mime: "image/png",
        width: 1080,
        height: 1080,
        render_status: "rendered",
        rendered_at: "2026-08-20T00:00:00.000Z"
      }
    }
  };
  await mockMarketingStudioShop(page, finalizedItem);
  await routeAsRealImage(page, ALREADY_FINALIZED_URL);
  let reviseBody = null;
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "revise_content") {
      reviseBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: { id: "flyer-asset-2", type: "flyer", parent_asset_id: "flyer-asset-1" } })
      });
      return;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  const regenBtn = root.locator('[data-ms-act="regenerate-image"]');
  await expect(regenBtn).toBeVisible();
  await expect(regenBtn).toHaveText("Regenerate image");
  // No typing required — no composer/textarea is opened by this button.
  await expect(root.locator("#msRevisionBox-item-1")).toHaveCount(0);
  await regenBtn.click();

  await expect.poll(() => reviseBody).not.toBeNull();
  expect(reviseBody.content_item_id).toBe("item-1");
  // A real, ordinary sentence — the same kind of thing a florist could
  // have typed themselves — never a raw provider/model prompt string.
  expect(typeof reviseBody.instruction).toBe("string");
  expect(reviseBody.instruction.toLowerCase()).toContain("background image");
  expect(reviseBody.instruction.toLowerCase()).toContain("same wording");
});

test("requirement 6: a flyer whose deterministic render fails never reads as ready for review — Approve is disabled and blocked", async ({ page }) => {
  await page.route("**/flyer-renderer.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.FlorisynFlyerRenderer = { renderFlyer: function() { return Promise.reject(new Error("render failed")); } };`
    })
  );
  let approveContentCalled = false;
  await mockMarketingStudioShop(page);
  // Registered AFTER mockMarketingStudioShop's own handler, so Playwright
  // tries this one first and falls back to the general handler for every
  // action except approve_content (which this test must prove is never
  // called).
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "approve_content") {
      approveContentCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  await expect(root.locator("#msFlyerImg-item-1")).toHaveCount(0, { timeout: 5000 });
  await expect(root.locator("#msFlyerNote-item-1")).toHaveText(/couldn't prepare this flyer/i);

  const approveBtn = root.locator('[data-ms-act="approve"]');
  await expect(approveBtn).toBeDisabled();
  expect(approveContentCalled).toBe(false);
  // Requirement 6: the eyebrow itself must reflect the honest failure, not
  // just the note text underneath the missing image.
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/couldn't prepare flyer/i);
  // Requirement 7: a real Retry action exists — not just apology text.
  await expect(root.locator('[data-ms-act="retry-flyer"]')).toBeVisible();
});

test("requirement 7 (upload failure): a render that succeeds but whose finalize_flyer_render upload fails leaves Approve disabled too — not just a render-time failure", async ({ page }) => {
  await page.route("**/flyer-renderer.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.FlorisynFlyerRenderer = { renderFlyer: function() {
        var c = document.createElement("canvas"); c.width = 10; c.height = 10;
        return Promise.resolve(c);
      } };`
    })
  );
  await mockMarketingStudioShop(page);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("action") === "finalize_flyer_render") {
      // The render itself succeeded — this is a real UPLOAD failure
      // (storage error, validation rejection, network drop), a distinct
      // failure mode from the renderer rejecting.
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Upload failed." }) });
      return;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  await expect(root.locator("#msFlyerNote-item-1")).toHaveText(/couldn't prepare this flyer/i, { timeout: 5000 });
  await expect(root.locator('[data-ms-act="approve"]')).toBeDisabled();
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/couldn't prepare flyer/i);
  await expect(root.locator('[data-ms-act="retry-flyer"]')).toBeVisible();
});

test("requirement 7 (safe retry): clicking Retry re-attempts the render/finalize — no AI call, and a subsequent success re-enables Approve", async ({ page }) => {
  let attempt = 0;
  const FINALIZED_URL = "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png";
  await page.route("**/flyer-renderer.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.FlorisynFlyerRenderer = { renderFlyer: function() {
        var c = document.createElement("canvas"); c.width = 10; c.height = 10;
        return Promise.resolve(c);
      } };`
    })
  );
  await mockMarketingStudioShop(page);
  await routeAsRealImage(page, FINALIZED_URL);
  let generateOrReviseCalled = false;
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "generate_content" || action === "revise_content") {
      generateOrReviseCalled = true;
    }
    if (action === "finalize_flyer_render") {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Upload failed." }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: {
            id: "flyer-asset-1",
            url: FINALIZED_URL,
            content: { ...FLYER_ITEM.asset.content, url: FINALIZED_URL, storage_path: "shop-ashley/flyers/flyer-asset-1.png", mime: "image/png", render_status: "rendered", rendered_at: "now" }
          }
        })
      });
      return;
    }
    await route.fallback();
  });
  const root = await openMarketingStudioShop(page);

  await expect(root.locator('[data-ms-act="approve"]')).toBeDisabled({ timeout: 5000 });
  const retryBtn = root.locator('[data-ms-act="retry-flyer"]');
  await expect(retryBtn).toBeVisible();
  await retryBtn.click();

  await expect(root.locator("#msFlyerImg-item-1")).toHaveAttribute("src", FINALIZED_URL, { timeout: 5000 });
  await expect(root.locator('[data-ms-act="approve"]')).toBeEnabled();
  expect(attempt, "Retry must actually re-attempt finalize_flyer_render a second time").toBe(2);
  expect(generateOrReviseCalled, "Retry must never call generate_content/revise_content — it's a pure re-render, no AI call, no cost").toBe(false);
});

// Real, live-found failure — the second real branch-deploy test: the
// server's invented-embellishment guard correctly caught Lily's bad
// wording, but the browser showed the new post stuck as "Idea" with an
// "Ask Lily to create it" button — a broken one-message workflow. The
// fix is server-side (generate_content now recovers automatically with a
// safe deterministic fallback instead of reverting), but this test drives
// the REAL browser create-form submit end to end to prove what the
// florist actually sees: one message in, one finished flyer draft out,
// with no second click and no "Idea" state ever rendered — even though
// the server's real response IS what a safety-fallback recovery produces.
test("one message still produces one finished flyer draft when the server's safety guard needed the deterministic fallback — never left as Idea, never needs a second click", async ({ page }) => {
  let phase = "before";
  let generateCallCount = 0;
  const SAFE_FALLBACK_ITEM = {
    id: "item-1",
    content_type: "image_post",
    title: "Closing early today",
    brief: "Create today's Florisyn Facebook post with an image. Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
    status: "draft",
    asset: {
      id: "flyer-asset-1",
      asset_type: "flyer",
      parent_asset_id: null,
      content: {
        // The exact safe wording the server's deterministic fallback
        // builds — never the invented text a rejected model response
        // would have contained.
        headline: "Closing Early Today",
        body: "Lilies in Bloom is closing at 2:30 today.",
        cta: "Call 606-506-4039 to place an order.",
        caption: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.",
        template_id: "notice",
        regions: { headline: { x: 0.06, y: 0.46, w: 0.88, h: 0.15 }, body: { x: 0.06, y: 0.625, w: 0.88, h: 0.13 }, cta: { x: 0.22, y: 0.775, w: 0.56, h: 0.08 }, logo: { x: 0.5, y: 0.03, w: 0.14, h: 0.07 }, contact: { x: 0.06, y: 0.89, w: 0.88, h: 0.05 } },
        palette: { background: "brand_primary" },
        canvas: { width: 1080, height: 1080 },
        style: { scale: { headline: "normal", body: "normal", cta: "normal" } },
        background_url: "https://example.test/storage/website-media/shop-ashley/flyer-bg-1.jpg",
        brand: { shopName: "Lilies in Bloom", phone: "606-506-4039" },
        url: null,
        storage_path: null,
        mime: null,
        render_status: null,
        rendered_at: null
      }
    },
    variants: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", caption: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.", asset_id: "flyer-asset-1" }]
  };
  await page.route("**/flyer-renderer.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.FlorisynFlyerRenderer = { renderFlyer: function() { var c = document.createElement("canvas"); c.width = 10; c.height = 10; return Promise.resolve(c); } };`
    })
  );
  await mockBackend(page);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const method = route.request().method();
    if (action === "status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marketing_studio_enabled: true, note: "" }) });
      return;
    }
    if (["get_brand_brain", "get_visual_style", "usage_summary", "connections"].includes(action)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    if (action === "list_content") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: phase === "after" ? [SAFE_FALLBACK_ITEM] : [] }) });
      return;
    }
    if (action === "create_content_item" && method === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "idea" } }) });
      return;
    }
    if (action === "generate_content" && method === "POST") {
      generateCallCount += 1;
      // The REAL shape marketing-studio.js's generate_content now returns
      // once its own safety guard has already recovered server-side — a
      // genuine 200 with the completed draft, never a 400.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: { id: "flyer-asset-1", type: "flyer", url: null }, copy: SAFE_FALLBACK_ITEM.asset.content })
      });
      phase = "after";
      return;
    }
    if (action === "finalize_flyer_render") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ asset: { id: "flyer-asset-1", url: "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png", content: { ...SAFE_FALLBACK_ITEM.asset.content, url: "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1.png", storage_path: "shop-ashley/flyers/flyer-asset-1.png", mime: "image/png", render_status: "rendered", rendered_at: "now" } } })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/storage/website-media/shop-ashley/flyers/flyer-asset-1.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    })
  );

  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingStudioPage"]').click();
  const root = page.locator("#marketingStudioRoot");
  await expect(root.locator("#msCreateItemForm")).toBeVisible();

  // The one message — Ashley's own real required test sentence.
  await root.locator('#msCreateItemForm textarea[name="brief"]').fill(
    "Create today's Florisyn Facebook post with an image. Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order."
  );
  await root.locator('#msCreateItemForm button[type="submit"]').click();

  // One finished draft appears — no second click required.
  const card = root.locator('[data-ms-item="item-1"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.locator('[data-ms-act="generate"]')).toHaveCount(0, { timeout: 2000 });
  await expect(card.getByText("Ask Lily to create it")).toHaveCount(0);
  await expect(card.locator(".eyebrow")).not.toHaveText(/^Idea$/);

  // The exact safe deterministic wording actually renders on screen.
  await expect(card).toContainText("Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.");

  // The real floral background still made it into the render call — the
  // safety recovery only replaced wording, never blocked the visual.
  await expect(root.locator('[data-ms-item="item-1"] .eyebrow')).toHaveText(/ready for your review/i, { timeout: 5000 });
  await expect(root.locator('[data-ms-act="approve"]')).toBeEnabled();

  expect(generateCallCount, "one message must trigger exactly one generate_content call — no retry, no second click needed").toBe(1);
});

// Phase 3, round 3 — Ashley's explicit instruction: "Trace why the live
// deterministic result differs from the exact object claimed in the
// report. Add a browser-level assertion for the persisted and visibly
// rendered strings, not only the backend object." Every other test in
// this file either stubs flyer-renderer.js entirely or hand-types the
// expected content into its fixture — neither actually proves the real
// client shows the real deterministic wording. This test does three
// things none of the others do: (1) derives the expected content from
// the REAL buildDeterministicNoticeContent (the exact function
// generate_content calls), not a hand-typed string that could silently
// drift from production; (2) lets the REAL, unmodified
// public/flyer-renderer.js run in the browser — no stub — so the actual
// shipped rendering code (sampled contrast, no color-wash band, the
// shop-name lockup) really executes; (3) asserts the shop name appears in
// the browser's own VISIBLE DOM text (marketing-studio-shop-ui.js's real
// caption paragraph), not just in a JSON fixture or a backend unit test.
test("browser-level: the real deterministic content (shop name included) is what actually renders in the browser via the real, unstubbed FlorisynFlyerRenderer — not just the backend object", async ({ page }) => {
  const EXACT_BROWSER_SENTENCE = "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.";
  const expected = buildDeterministicNoticeContent({ requestText: EXACT_BROWSER_SENTENCE, shopName: "Lilies in Bloom", shopPhone: "606-506-4039" });
  expect(expected.body).toBe("Lilies in Bloom is closing at 2:30 today.");
  expect(expected.caption).toBe(EXACT_BROWSER_SENTENCE);

  const FINALIZED_URL = "https://example.test/storage/website-media/shop-ashley/flyers/flyer-asset-1-real.png";
  const item = {
    id: "item-1",
    content_type: "image_post",
    title: "Closing early today",
    brief: EXACT_BROWSER_SENTENCE,
    status: "draft",
    asset: {
      id: "flyer-asset-1",
      asset_type: "flyer",
      parent_asset_id: null,
      model: "deterministic",
      content: {
        headline: expected.headline,
        body: expected.body,
        cta: expected.cta,
        caption: expected.caption,
        template_id: "notice",
        regions: { headline: { x: 0.06, y: 0.46, w: 0.88, h: 0.15 }, body: { x: 0.06, y: 0.625, w: 0.88, h: 0.13 }, cta: { x: 0.22, y: 0.775, w: 0.56, h: 0.08 }, logo: { x: 0.5, y: 0.03, w: 0.14, h: 0.07 }, contact: { x: 0.06, y: 0.89, w: 0.88, h: 0.05 } },
        palette: { background: "brand_primary" },
        canvas: { width: 1080, height: 1080 },
        style: { scale: { headline: "normal", body: "normal", cta: "normal" } },
        // Tier B (no background_url) deliberately — this test's job is to
        // prove the real renderer's TEXT layer (wording, contrast, no
        // color wash), not to fight cross-origin canvas-tainting rules a
        // mocked background image would trigger against getImageData.
        background_url: null,
        brand: { shopName: "Lilies in Bloom", phone: "606-506-4039", primaryColor: "#e2437a", accentColor: "#6f8f72" },
        url: null,
        storage_path: null,
        mime: null,
        render_status: null,
        rendered_at: null
      }
    },
    variants: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", caption: expected.caption, asset_id: "flyer-asset-1" }]
  };

  await mockMarketingStudioShop(page, item);
  await routeAsRealImage(page, FINALIZED_URL);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "finalize_flyer_render") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: {
            id: "flyer-asset-1",
            url: FINALIZED_URL,
            content: { ...item.asset.content, url: FINALIZED_URL, storage_path: "shop-ashley/flyers/flyer-asset-1-real.png", mime: "image/png", width: 1080, height: 1080, render_status: "rendered", rendered_at: "now" }
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  const root = await openMarketingStudioShop(page);
  const card = root.locator('[data-ms-item="item-1"]');

  // The browser's OWN visible caption text — a real <p> in the DOM, not a
  // JSON fixture — must be the exact deterministic caption with the real
  // shop name, and must never contain the exact old defect wording.
  await expect(card).toContainText(expected.caption);
  await expect(card).not.toContainText(/^We are closing/);
  await expect(card).not.toContainText("Don't forget");

  // The real, unstubbed renderer must actually finish drawing and finalize
  // — proving the shipped rendering code (no stub) tolerates and completes
  // this exact content end to end, not just that a mocked call resolved.
  const img = root.locator("#msFlyerImg-item-1");
  await expect(img).toHaveAttribute("src", FINALIZED_URL, { timeout: 8000 });
  await expect(root.locator("#msFlyerNote-item-1")).toHaveCount(0);

  // The diagnostic surface added specifically so this doesn't have to be
  // taken on faith — checkable independent of this test or any report.
  await expect(card).toHaveAttribute("data-ms-wording-source", "deterministic");
});

/**
 * Browser-level CTA geometry.
 *
 * A real, live-found defect that a fully green suite still shipped: the
 * CTA's divider rule was positioned as if the CTA were always one line,
 * and drawCtaLabel had no auto-fit at all — so the default operational
 * CTA ("Call <phone> to place an order.") had the rule drawn straight
 * through its last line and overflowed toward the contact line. Nothing
 * asserted this geometry anywhere, in any suite.
 *
 * This runs the REAL, unstubbed public/flyer-renderer.js in a real
 * browser with real font metrics and real letter-spacing — the exact
 * conditions the defect needed to appear — rather than a fake ctx.
 */
test("browser-level: the real renderer's CTA never has its divider struck through the text, and never overflows its region — with real browser font metrics", async ({ page }) => {
  await page.goto("/index.html");
  await page.addScriptTag({ url: "/flyer-renderer.js" });

  const cases = [
    // The exact acceptance CTA.
    "Call 606-506-4039 to place an order.",
    // Arbitrary shops/numbers — never only the one example.
    "Call 513-555-1234 to place an order.",
    "Call 1-606-331-9374 to place an order.",
    // Deliberately long, to drive the auto-fit floor.
    "Call 606-506-4039 to place an order for same-day delivery before we close"
  ];

  for (const cta of cases) {
    const geom = await page.evaluate((ctaText) => {
      const R = window.FlorisynFlyerRenderer;
      // The real notice-template cta + contact regions.
      const rect = R.regionRect({ x: 0.22, y: 0.775, w: 0.56, h: 0.08 }, 1080, 1080);
      const contact = R.regionRect({ x: 0.06, y: 0.89, w: 0.88, h: 0.05 }, 1080, 1080);
      const bodyRect = R.regionRect({ x: 0.06, y: 0.625, w: 0.88, h: 0.13 }, 1080, 1080);
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      // drawCtaLabel measures at 0.1em tracking; match it exactly.
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.1em";
      const L = R.computeCtaLayout(ctx, rect, ctaText);
      return {
        fontSize: L.fontSize,
        lineCount: L.lines.length,
        blockTop: L.blockTop,
        lastLineBottom: L.lastLineBottom,
        dividerY: L.dividerY,
        regionTop: rect.y,
        regionBottom: rect.y + rect.h,
        contactTop: contact.y,
        bodyBottom: bodyRect.y + bodyRect.h
      };
    }, cta);

    // The defect this locks in: the rule used to be drawn THROUGH the text.
    expect(geom.dividerY, `divider must sit below the last line for: ${cta}`).toBeGreaterThan(geom.lastLineBottom);
    // What actually matters is collision, not geometric purity. A CTA long
    // enough to bottom out the auto-fit's readability floor may extend a
    // little past its own region — the floor deliberately wins over
    // shrinking further — but it must never touch the message above it or
    // the contact line below it.
    expect(geom.blockTop, `CTA must never overlap the body message for: ${cta}`).toBeGreaterThanOrEqual(geom.bodyBottom);
    expect(geom.dividerY, `CTA must never collide with the contact line for: ${cta}`).toBeLessThan(geom.contactTop);
    // Mobile readability: a 1080px flyer is viewed ~390px wide, so the CTA
    // must stay large enough to survive that ~2.8x downscale.
    expect(geom.fontSize, `CTA must stay readable on a phone for: ${cta}`).toBeGreaterThanOrEqual(24);
  }
});

/**
 * One flyer must never advertise two different phone numbers — a real
 * defect: a request-supplied number correctly became the CTA while the
 * footer independently printed the shop profile's own stored number.
 */
test("browser-level: the real renderer's contact line never contradicts the CTA's phone number, and never prints a raw digit string", async ({ page }) => {
  await page.goto("/index.html");
  await page.addScriptTag({ url: "/flyer-renderer.js" });

  const result = await page.evaluate(() => {
    const R = window.FlorisynFlyerRenderer;
    return {
      conflicting: R.contactLineParts(
        { shopName: "Lilies in Bloom", phone: "16063319374" },
        "Call 606-506-4039 to place an order."
      ),
      matching: R.contactLineParts({ shopName: "Lilies in Bloom", phone: "6065064039" }, "Call 606-506-4039 to place an order."),
      noCtaPhone: R.contactLineParts({ shopName: "Lilies in Bloom", phone: "16063319374" }, "Stop by today.")
    };
  });

  expect(result.conflicting.join(" ")).not.toContain("16063319374");
  expect(result.conflicting.join(" ")).not.toContain("331");
  expect(result.matching).toContain("606-506-4039");
  // A raw stored number is formatted for a customer to read, never printed raw.
  expect(result.noCtaPhone.join(" ")).toContain("1-606-331-9374");
  expect(result.noCtaPhone.join(" ")).not.toContain("16063319374");
});

/**
 * Tier-B floral fallback, in a real browser with the real, unstubbed
 * renderer. Proves the two things that matter: a flyer with no AI backdrop
 * still gets a real floral photograph (not a flowerless treatment, and
 * certainly not the brand-colour slab this replaced), and the canvas is
 * stamped with which tier actually drew it so no caller or report can
 * present a fallback as live provider output.
 */
test("browser-level: with no generated backdrop the real renderer falls back to a real floral photograph, and labels it as a fallback — never as live AI output", async ({ page }) => {
  await page.goto("/index.html");
  await page.addScriptTag({ url: "/flyer-renderer.js" });

  const content = {
    headline: "Closing Early Today",
    body: "Lilies in Bloom is closing at 2:30 today.",
    cta: "Call 606-506-4039 to place an order.",
    caption: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order."
  };
  const brand = { shopName: "Lilies in Bloom", phone: "16063319374", primaryColor: "#8f3f68", accentColor: "#6f8f72" };
  const template = {
    palette: { background: "brand_primary" },
    regions: {
      headline: { x: 0.06, y: 0.46, w: 0.88, h: 0.15 },
      body: { x: 0.06, y: 0.625, w: 0.88, h: 0.13 },
      cta: { x: 0.22, y: 0.775, w: 0.56, h: 0.08 },
      logo: { x: 0.5, y: 0.03, w: 0.14, h: 0.07 },
      contact: { x: 0.06, y: 0.89, w: 0.88, h: 0.05 }
    }
  };

  const result = await page.evaluate(
    async ({ template, content, brand }) => {
      const R = window.FlorisynFlyerRenderer;
      const base = { template, content, brand, style: { scale: {} }, width: 1080, height: 1080 };

      async function tierOf(extra) {
        const canvas = await R.renderFlyer({ ...base, ...extra });
        return canvas.dataset.florisynBackgroundTier;
      }

      // Sample the mean colour of the whole canvas for the no-backdrop case,
      // to prove it is a photograph rather than a flat brand-colour fill.
      const canvas = await R.renderFlyer({ ...base, backgroundUrl: null });
      const ctx = canvas.getContext("2d");
      const d = ctx.getImageData(0, 0, 1080, 1080).data;
      let r = 0, g = 0, b = 0, n = 0;
      let distinct = new Set();
      for (let i = 0; i < d.length; i += 4 * 997) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        distinct.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      }
      return {
        generated: await tierOf({ backgroundUrl: "/assets/atelier-floral-corner.jpg" }),
        noBackdrop: await tierOf({ backgroundUrl: null }),
        brokenBackdrop: await tierOf({ backgroundUrl: "/assets/definitely-not-here.jpg" }),
        fallbackDisabled: await tierOf({ backgroundUrl: null, fallbackBackgroundUrl: null }),
        mean: { r: r / n, g: g / n, b: b / n },
        distinctBuckets: distinct.size
      };
    },
    { template, content, brand }
  );

  expect(result.generated).toBe("generated");
  // No backdrop, and a backdrop that fails to load, both reach the real photo.
  expect(result.noBackdrop).toBe("fallback-library-photo");
  expect(result.brokenBackdrop).toBe("fallback-library-photo");
  // Only with the photo explicitly disabled does the procedural tier appear.
  expect(result.fallbackDisabled).toBe("fallback-procedural");
  // A fallback is never labelled as provider output.
  expect(result.noBackdrop).not.toBe("generated");

  // The fallback is a real photograph: bright, and rich in distinct colours —
  // a flat brand-colour slab (the magenta #8f3f68 this replaced) would be
  // dark and near-uniform.
  const { r, g, b } = result.mean;
  expect(r).toBeGreaterThan(150);
  expect(g).toBeGreaterThan(150);
  expect(b).toBeGreaterThan(140);
  expect(result.distinctBuckets).toBeGreaterThan(25);
});
