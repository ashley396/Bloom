import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Priority 7 of the "as far as technically possible" pass — the two
 * disclosed UI gaps: caption editing during review, and add/remove target
 * platforms before approval/scheduling. Every state here is driven by
 * scripted marketing-studio.js responses matching what the real backend
 * actions (update_variant_caption/add_content_platform/
 * remove_content_platform) actually return.
 */

function draftItem(overrides = {}) {
  return {
    id: "item-1",
    content_type: "image_post",
    title: "Fall Bouquet Launch",
    brief: "Announce the new fall arrangement line.",
    status: "draft",
    uses_ai_clone: false,
    requires_human_approval: true,
    updated_at: "2026-09-01T12:00:00.000Z",
    variants: [
      { id: "variant-fb", content_item_id: "item-1", platform: "facebook", status: "pending", scheduled_at: null, caption: "Introducing our fall collection!", ai_disclosure_required: false, disclosure_applied: false }
    ],
    ...overrides
  };
}

async function mockMarketingStudio(page, { items, onAction } = {}) {
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
        body: JSON.stringify({ clone_provider: { live: false }, note: "NOT LIVE.", supported_platforms: [{ platform: "facebook", live: false }] })
      });
      return;
    }
    if (action === "list_content" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
      return;
    }
    if (action === "list_clone_consent" || action === "list_personal_brand_reference_photos" || action === "get_personal_brand_profile" || action === "usage_summary") {
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

test.describe("Marketing Studio caption editing", () => {
  test("editing a caption calls update_variant_caption with the real edited text and confirms it saved", async ({ page }) => {
    let savedBody = null;
    const item = draftItem();
    await mockMarketingStudio(page, {
      items: [item],
      onAction: async (route, action, body) => {
        if (action === "update_variant_caption") {
          savedBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ variant: { id: "variant-fb", platform: "facebook", caption: body.caption, status: "pending" } }) });
          return true;
        }
        if (action === "list_content" && savedBody) {
          const updated = draftItem({ variants: [{ ...item.variants[0], caption: savedBody.caption }] });
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [updated] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    const textarea = detail.locator('[data-caption-input="variant-fb"]');
    await expect(textarea).toHaveValue("Introducing our fall collection!");
    await textarea.fill("Our fall collection just landed — order today!");
    await detail.locator('[data-save-caption="variant-fb"]').click();

    expect(savedBody.platform_variant_id).toBe("variant-fb");
    expect(savedBody.caption).toBe("Our fall collection just landed — order today!");
    await expect(detail.locator('[data-caption-status="variant-fb"]')).toContainText("Saved.");
  });

  test("a published variant's caption is shown as read-only text — no edit control is ever rendered for it", async ({ page }) => {
    const item = draftItem({
      status: "scheduled",
      variants: [{ id: "variant-fb", content_item_id: "item-1", platform: "facebook", status: "published", scheduled_at: "2026-09-05T18:00:00.000Z", caption: "Already live, can't touch this.", ai_disclosure_required: false, disclosure_applied: false }]
    });
    await mockMarketingStudio(page, { items: [item] });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await expect(detail).toContainText("Already live, can't touch this.");
    await expect(detail.locator('[data-caption-input="variant-fb"]')).toHaveCount(0);
    await expect(detail.locator('[data-save-caption="variant-fb"]')).toHaveCount(0);
  });

  test("an empty caption is rejected client-side without ever calling the backend", async ({ page }) => {
    let called = false;
    const item = draftItem();
    await mockMarketingStudio(page, {
      items: [item],
      onAction: async (route, action) => {
        if (action === "update_variant_caption") {
          called = true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await detail.locator('[data-caption-input="variant-fb"]').fill("   ");
    await detail.locator('[data-save-caption="variant-fb"]').click();
    await expect(detail.locator('[data-caption-status="variant-fb"]')).toContainText("can't be empty");
    expect(called).toBe(false);
  });
});

test.describe("Marketing Studio platform add/remove", () => {
  test("adding a platform calls add_content_platform and the new platform appears in the list", async ({ page }) => {
    let addedBody = null;
    const item = draftItem();
    await mockMarketingStudio(page, {
      items: [item],
      onAction: async (route, action, body) => {
        if (action === "add_content_platform") {
          addedBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ variant: { id: "variant-ig", platform: "instagram", caption: "Introducing our fall collection!", status: "pending" }, copiedFromExisting: true, note: "Copied the caption from an existing platform as a starting point — edit it before approving." }) });
          return true;
        }
        if (action === "list_content" && addedBody) {
          const updated = draftItem({
            variants: [item.variants[0], { id: "variant-ig", content_item_id: "item-1", platform: "instagram", status: "pending", scheduled_at: null, caption: "Introducing our fall collection!", ai_disclosure_required: false, disclosure_applied: false }]
          });
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [updated] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await detail.locator("#msAddPlatformSelect").selectOption("instagram");
    await detail.locator("#msAddPlatformBtn").click();

    expect(addedBody.content_item_id).toBe("item-1");
    expect(addedBody.platform).toBe("instagram");
    await expect(detail).toContainText("instagram");
    await expect(detail.locator("#msAddPlatformStatus")).toContainText("Copied the caption");
  });

  test("removing a platform calls remove_content_platform after confirmation and it disappears from the list", async ({ page }) => {
    let removedBody = null;
    const item = draftItem({
      variants: [
        { id: "variant-fb", content_item_id: "item-1", platform: "facebook", status: "pending", scheduled_at: null, caption: "Fall collection", ai_disclosure_required: false, disclosure_applied: false },
        { id: "variant-ig", content_item_id: "item-1", platform: "instagram", status: "pending", scheduled_at: null, caption: "Fall collection", ai_disclosure_required: false, disclosure_applied: false }
      ]
    });
    await mockMarketingStudio(page, {
      items: [item],
      onAction: async (route, action, body) => {
        if (action === "remove_content_platform") {
          removedBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, platform: "instagram", remainingPlatforms: ["facebook"] }) });
          return true;
        }
        if (action === "list_content" && removedBody) {
          const updated = draftItem({ variants: [item.variants[0]] });
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [updated] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    page.once("dialog", (dialog) => dialog.accept());
    await detail.locator('[data-remove-platform="instagram"]').click();
    await page.waitForTimeout(100);

    expect(removedBody.platform).toBe("instagram");
    await expect(detail.locator('[data-remove-platform="instagram"]')).toHaveCount(0);
  });

  test("the last remaining platform has no remove control at all — the client never even offers the request", async ({ page }) => {
    const item = draftItem();
    await mockMarketingStudio(page, { items: [item] });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await expect(detail.locator('[data-remove-platform="facebook"]')).toHaveCount(0);
  });

  test("once approved, no add-platform or remove-platform control is shown — the platform set reads as locked", async ({ page }) => {
    const item = draftItem({
      status: "approved",
      variants: [
        { id: "variant-fb", content_item_id: "item-1", platform: "facebook", status: "ready", scheduled_at: null, caption: "Fall collection", ai_disclosure_required: false, disclosure_applied: false },
        { id: "variant-ig", content_item_id: "item-1", platform: "instagram", status: "ready", scheduled_at: null, caption: "Fall collection", ai_disclosure_required: false, disclosure_applied: false }
      ]
    });
    await mockMarketingStudio(page, { items: [item] });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await expect(detail.locator("#msAddPlatformBtn")).toHaveCount(0);
    await expect(detail.locator('[data-remove-platform="facebook"]')).toHaveCount(0);
    await expect(detail).toContainText("Platform selection is locked");
  });
});
