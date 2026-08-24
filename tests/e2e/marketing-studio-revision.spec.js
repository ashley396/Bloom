import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Continuing PR #177 — the conversational revision loop's UI: "Generate →
 * see result → tell Lily what to change → see revised result → keep
 * refining → Save/Approve when satisfied," directly on the content-detail
 * view. Every state here is driven by scripted marketing-studio.js
 * responses matching what the real backend actions (revise_content/
 * revert_content_revision, plus list_content's new embedded `asset`)
 * actually return.
 */

const DRAFT_ITEM_WITH_ASSET = {
  id: "item-1",
  content_type: "image_post",
  title: "Fall Bouquet Launch",
  brief: "Announce the new fall arrangement line.",
  status: "draft",
  uses_ai_clone: false,
  requires_human_approval: true,
  updated_at: "2026-09-01T12:00:00.000Z",
  asset: { id: "asset-1", asset_type: "image", content: { url: "https://fake.storage/fall.jpg", caption: "Introducing our fall collection!" }, parent_asset_id: null },
  variants: [
    { id: "variant-1", content_item_id: "item-1", platform: "facebook", status: "pending", scheduled_at: null, caption: "Introducing our fall collection!", ai_disclosure_required: false, disclosure_applied: false, asset_id: "asset-1" }
  ]
};

async function mockMarketingStudio(page, { items = [DRAFT_ITEM_WITH_ASSET], onAction } = {}) {
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clone_provider: { live: false }, note: "NOT LIVE.", supported_platforms: [] }) });
      return;
    }
    if (action === "list_content" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
      return;
    }
    if (["connections", "list_clone_consent", "list_personal_brand_reference_photos", "get_personal_brand_profile", "usage_summary", "get_visual_style"].includes(action)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], profile: {}, estimated_total_cents: 0, actual_total_cents: 0, categories: {}, summary: "" }) });
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

test.describe("Marketing Studio — conversational revision", () => {
  test("a draft item with a generated image shows the revision box with a live preview", async ({ page }) => {
    await mockMarketingStudio(page);
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    const box = root.locator("#msRevisionBox");
    await expect(box).toBeVisible();
    await expect(box.locator("img")).toHaveAttribute("src", "https://fake.storage/fall.jpg");
    // Nothing to undo yet — this is the original generation, no parent.
    await expect(root.locator("#msUndoRevisionBtn")).toHaveCount(0);
  });

  test("sending a revision instruction calls revise_content and the panel refreshes with the new result", async ({ page }) => {
    let revisionBody = null;
    const revisedItem = {
      ...DRAFT_ITEM_WITH_ASSET,
      asset: { id: "asset-2", asset_type: "image", content: { url: "https://fake.storage/fall-luxury.jpg", caption: "Introducing our fall collection!" }, parent_asset_id: "asset-1" }
    };
    await mockMarketingStudio(page, {
      onAction: async (route, action, body) => {
        if (action === "revise_content") {
          revisionBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: revisedItem.asset }) });
          return true;
        }
        if (action === "list_content" && route.request().method() === "GET" && revisionBody) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [revisedItem] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await root.locator("#msRevisionInput").fill("use a luxury flower shop background instead");
    await root.locator("#msReviseBtn").click();
    expect(revisionBody).toMatchObject({ content_item_id: "item-1", instruction: "use a luxury flower shop background instead" });
    await expect(root.locator("#msRevisionBox img")).toHaveAttribute("src", "https://fake.storage/fall-luxury.jpg");
    // Now that a revision exists, Undo/previous version must be offered.
    await expect(root.locator("#msUndoRevisionBtn")).toBeVisible();
  });

  test("Undo / previous version calls revert_content_revision and restores the original result", async ({ page }) => {
    const revisedItem = {
      ...DRAFT_ITEM_WITH_ASSET,
      asset: { id: "asset-2", asset_type: "image", content: { url: "https://fake.storage/fall-luxury.jpg", caption: "Introducing our fall collection!" }, parent_asset_id: "asset-1" }
    };
    let undoCalled = false;
    await mockMarketingStudio(page, {
      items: [revisedItem],
      onAction: async (route, action) => {
        if (action === "revert_content_revision") {
          undoCalled = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: DRAFT_ITEM_WITH_ASSET.asset }) });
          return true;
        }
        if (action === "list_content" && route.request().method() === "GET" && undoCalled) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [DRAFT_ITEM_WITH_ASSET] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await expect(root.locator("#msUndoRevisionBtn")).toBeVisible();
    await root.locator("#msUndoRevisionBtn").click();
    expect(undoCalled).toBe(true);
    await expect(root.locator("#msRevisionBox img")).toHaveAttribute("src", "https://fake.storage/fall.jpg");
    await expect(root.locator("#msUndoRevisionBtn")).toHaveCount(0);
  });

  test("an approved item shows no revision box — continuing the conversation is never how you bypass review", async ({ page }) => {
    await mockMarketingStudio(page, { items: [{ ...DRAFT_ITEM_WITH_ASSET, status: "approved" }] });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await expect(root.locator("#msRevisionBox")).toHaveCount(0);
  });

  test("an item with no generated asset yet shows no revision box — nothing to revise before Generate", async ({ page }) => {
    await mockMarketingStudio(page, { items: [{ ...DRAFT_ITEM_WITH_ASSET, status: "idea", asset: null, variants: [] }] });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await expect(root.locator("#msRevisionBox")).toHaveCount(0);
    // Generate remains the only way to get a first result.
    await expect(root.locator("#msGenerateBtn")).toBeVisible();
  });
});
