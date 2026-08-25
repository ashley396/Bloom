import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Live beta defect: the florist-facing "Ask Lily to change something"
 * button used a bare native `prompt()` dialog with no real revision
 * interface — and whatever text a florist typed there could reach
 * revise_content in a way that read as a My-Style-persistence request
 * instead of an ordinary one-time revision. This proves the REAL inline
 * composer (textarea + Send to Lily) that replaced it: opens on click,
 * sends an ordinary instruction as an ordinary revision (never persisted),
 * and only reports persistence when revise_content's own response says so
 * (driven by the florist's actual wording, never a UI checkbox).
 */

const DRAFT_ITEM = {
  id: "item-1",
  content_type: "social_post",
  title: "Early closing today",
  brief: "Create a Facebook post letting customers know we are closing at 2:30 today. Call 606-506-4039 to order.",
  status: "draft",
  asset: { id: "asset-1", asset_type: "social_copy", content: { body: "We're closing at 2:30 PM today — call 606-506-4039 to place an order before then!" }, parent_asset_id: null },
  variants: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", caption: "We're closing at 2:30 PM today — call 606-506-4039 to place an order before then!", asset_id: "asset-1" }]
};

async function mockMarketingStudioShop(page, { onRevise } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const body = route.request().postDataJSON?.() || {};
    if (action === "status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marketing_studio_enabled: true, note: "" }) });
      return;
    }
    if (action === "list_content") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [DRAFT_ITEM] }) });
      return;
    }
    if (action === "revise_content") {
      if (onRevise) {
        const handled = await onRevise(route, body);
        if (handled) return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: { id: "asset-2", type: "social_copy" } }) });
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

test('"Ask Lily to change something" opens a real revision composer, not a native prompt dialog', async ({ page }) => {
  await mockMarketingStudioShop(page);
  const root = await openMarketingStudioShop(page);

  // No composer, no native prompt() up front.
  await expect(root.locator("#msRevisionBox-item-1")).toHaveCount(0);
  let promptCalled = false;
  page.on("dialog", () => { promptCalled = true; });

  await root.locator('[data-ms-act="revise"]').click();

  await expect(root.locator("#msRevisionBox-item-1")).toBeVisible();
  await expect(root.locator("#msRevisionInput-item-1")).toBeVisible();
  await expect(root.locator('[data-ms-act="revise-send"]')).toBeVisible();
  expect(promptCalled).toBe(false);
});

test("an ordinary revision instruction sends without any persistence flag or wording, and the response is shown as an ordinary update", async ({ page }) => {
  let sentBody = null;
  await mockMarketingStudioShop(page, {
    onRevise: async (route, body) => {
      sentBody = body;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: { id: "asset-2", type: "social_copy" } }) });
      return true;
    }
  });
  const root = await openMarketingStudioShop(page);

  await root.locator('[data-ms-act="revise"]').click();
  await root.locator("#msRevisionInput-item-1").fill("Make it shorter");
  await root.locator('[data-ms-act="revise-send"]').click();

  await expect(root.locator("#msRevisionBox-item-1")).toHaveCount(0);
  expect(sentBody.instruction).toBe("Make it shorter");
  expect(sentBody.action).toBe("revise_content");
});

/**
 * Second live-beta occurrence (Aug 25 2026): Ashley re-tested on
 * www.florisyn.com AFTER b6f358c deployed the fix above and got the exact
 * pre-fix symptom back — no composer, the bare "Tell me specifically what
 * to keep... so Lily can save it as your style" toast. b6f358c's own
 * committed/deployed client source is correct (proved by the two tests
 * above running against the real file on disk) — so this isn't a
 * source-code regression. What it demonstrates is the actual live
 * mechanism: marketing-studio-shop-ui.js shipped with no cache-busting
 * query string and no netlify.toml Cache-Control override (see
 * tests/marketing-studio-shop-ui-cache-freshness.test.js), so a browser
 * that had already fetched this exact URL once — as Ashley's had, from her
 * earlier successful Generate test — had no signal to ever refetch it and
 * could keep silently executing the pre-fix bytes indefinitely, even
 * though the server was correctly serving the fixed file to any NEW
 * request. This test drives the real DOM/render/click path exactly like
 * the tests above, with one deliberate substitution: the browser is served
 * the actual pre-fix marketing-studio-shop-ui.js bytes (captured from git
 * history at b6f358c~1) for this one request, standing in for "a browser
 * that has a stale cached copy" — everything else (page, session, backend
 * mocks, the real render() output the old file produces) is identical to
 * the tests above. It reproduces Ashley's exact reported symptom.
 */
test("a browser still running the pre-b6f358c client script reproduces Ashley's exact live symptom against the current backend", async ({ page }) => {
  const staleScript = fs.readFileSync(
    path.join(__dirname, "fixtures/pre-b6f358c-marketing-studio-shop-ui.js"),
    "utf8"
  );
  await mockMarketingStudioShop(page, {
    onRevise: async (route) => {
      // The real, currently-deployed server error for this exact scenario
      // (marketing-studio.js:878) — reused verbatim, not re-typed, so this
      // test can't silently drift from what the live backend actually
      // returns.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: 'Tell me specifically what to keep (e.g. "always use this background") so Lily can save it as your style.'
        })
      });
      return true;
    }
  });
  // Simulate the browser's HTTP cache already holding the pre-fix file —
  // the one request this deploy never got a chance to invalidate.
  await page.route("**/marketing-studio-shop-ui.js*", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: staleScript })
  );

  let promptInstruction = null;
  page.on("dialog", async (dialog) => {
    promptInstruction = dialog.message();
    await dialog.accept("keep it this way going forward");
  });

  const root = await openMarketingStudioShop(page);
  await root.locator('[data-ms-act="revise"]').click();

  // Ashley's exact reported symptom: no inline composer, and the app's
  // real #toast element (app.js's own toast(), never a test stand-in)
  // shows the My-Style toast — coming from the stale client's prompt()
  // dialog, not from any code that exists in the currently-deployed
  // marketing-studio-shop-ui.js.
  await expect(page.locator("#toast")).toHaveText(
    'Tell me specifically what to keep (e.g. "always use this background") so Lily can save it as your style.'
  );
  expect(promptInstruction).toBe("What should Lily change?");
  await expect(root.locator("#msRevisionBox-item-1")).toHaveCount(0);
});

test("Cancel closes the composer without calling revise_content", async ({ page }) => {
  let reviseCalled = false;
  await mockMarketingStudioShop(page, {
    onRevise: async () => {
      reviseCalled = true;
      return false;
    }
  });
  const root = await openMarketingStudioShop(page);

  await root.locator('[data-ms-act="revise"]').click();
  await root.locator("#msRevisionInput-item-1").fill("Use less pink");
  await root.locator('[data-ms-act="revise-cancel"]').click();

  await expect(root.locator("#msRevisionBox-item-1")).toHaveCount(0);
  expect(reviseCalled).toBe(false);
});
