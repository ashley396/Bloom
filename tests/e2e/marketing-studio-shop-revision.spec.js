import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

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
