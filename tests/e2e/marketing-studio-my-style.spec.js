import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Lily Creative Style Learning — the "My Style" panel added to
 * public/marketing-studio-admin.js. Every state here is driven by scripted
 * marketing-studio.js responses matching what the real backend actions
 * (get_visual_style/update_visual_style/forget_visual_style_trait/
 * reset_visual_style) actually return.
 */

async function mockMarketingStudio(page, { onAction } = {}) {
  await mockAdminBackend(page);
  await page.route("**/.netlify/functions/marketing-studio**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const body = route.request().postDataJSON?.() || {};
    if (onAction) {
      const handled = await onAction(route, action, body);
      if (handled) return;
    }
    if (action === "status" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ clone_provider: { live: false }, note: "NOT LIVE.", supported_platforms: [] })
      });
      return;
    }
    if (
      action === "list_content" ||
      action === "connections" ||
      action === "list_clone_consent" ||
      action === "list_personal_brand_reference_photos" ||
      action === "get_personal_brand_profile" ||
      action === "usage_summary"
    ) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], profile: {}, estimated_total_cents: 0, actual_total_cents: 0 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openMarketingStudio(page) {
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
  await page.locator('aside nav button[data-view="marketingStudio"]').click();
  const root = page.locator("#marketingStudioRoot");
  await root.locator("#msShopId").fill("shop-1");
  await root.locator("#msLoadShop").click();
  return root;
}

test.describe("Marketing Studio — My Style", () => {
  test("renders what Lily has already learned, grouped by category, with plain human labels", async ({ page }) => {
    await mockMarketingStudio(page, {
      onAction: async (route, action) => {
        if (action === "get_visual_style") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              categories: {
                background_style: { active: [{ text: "soft luxury backgrounds", polarity: "positive" }], learning: [] },
                colors: { active: [], learning: [{ text: "hot pink", polarity: "negative" }] }
              },
              summary: "background style: soft luxury backgrounds"
            })
          });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    const styleList = root.locator("#msStyleList");
    await expect(styleList).toContainText("Backgrounds:");
    await expect(styleList).toContainText("soft luxury backgrounds");
    await expect(styleList).toContainText("still learning");
    // No internal ML/dev jargon anywhere in the panel.
    await expect(styleList).not.toContainText("embedding");
    await expect(styleList).not.toContainText("confidence");
  });

  test("an empty style shows a real, honest empty state — never a blank panel", async ({ page }) => {
    await mockMarketingStudio(page, {
      onAction: async (route, action) => {
        if (action === "get_visual_style") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: {}, summary: "" }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msStyleList")).toContainText("hasn't learned any visual style");
  });

  test("saving an explicit preference calls update_visual_style with the real category/text/polarity and re-renders the result", async ({ page }) => {
    let updateBody = null;
    await mockMarketingStudio(page, {
      onAction: async (route, action, body) => {
        if (action === "get_visual_style") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: {}, summary: "" }) });
          return true;
        }
        if (action === "update_visual_style") {
          updateBody = body;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ categories: { mood: { active: [{ text: "elegant", polarity: "positive" }], learning: [] } }, summary: "mood: elegant" })
          });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator("#msStyleCategory").selectOption("mood");
    await root.locator("#msStyleText").fill("elegant");
    await root.locator("#msStylePolarity").selectOption("positive");
    await root.locator("#msStyleAddForm button[type=submit]").click();
    await expect(root.locator("#msStyleStatus")).toContainText("Saved");
    await expect(root.locator("#msStyleList")).toContainText("elegant");
    expect(updateBody.updates).toEqual([{ category: "mood", text: "elegant", polarity: "positive" }]);
  });

  test("forgetting a preference calls forget_visual_style_trait with the exact category/text and re-renders without it", async ({ page }) => {
    let forgetBody = null;
    await mockMarketingStudio(page, {
      onAction: async (route, action, body) => {
        if (action === "get_visual_style") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ categories: { mood: { active: [{ text: "elegant", polarity: "positive" }], learning: [] } }, summary: "mood: elegant" })
          });
          return true;
        }
        if (action === "forget_visual_style_trait") {
          forgetBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: {}, summary: "" }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msStyleList")).toContainText("elegant");
    await root.locator("#msStyleList [data-style-forget]").click();
    expect(forgetBody).toMatchObject({ category: "mood", text: "elegant" });
    await expect(root.locator("#msStyleList")).toContainText("hasn't learned any visual style");
  });

  test("resetting learned style asks for confirmation, then calls reset_visual_style and clears the panel", async ({ page }) => {
    let resetCalled = false;
    await mockMarketingStudio(page, {
      onAction: async (route, action) => {
        if (action === "get_visual_style") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ categories: { mood: { active: [{ text: "elegant", polarity: "positive" }], learning: [] } }, summary: "mood: elegant" })
          });
          return true;
        }
        if (action === "reset_visual_style") {
          resetCalled = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: {}, summary: "" }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    page.once("dialog", (dialog) => dialog.accept());
    await root.locator("#msStyleResetBtn").click();
    await page.waitForTimeout(100);
    expect(resetCalled).toBe(true);
    await expect(root.locator("#msStyleList")).toContainText("hasn't learned any visual style");
  });
});
