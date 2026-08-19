import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * The admin-facing half of the self-service photo manager
 * (public/admin-photo-manager-ui.js, window.BloomPhotoManager) — lets the
 * platform owner upload/edit/delete Floral Library and Website Studio
 * hero photos from the admin console instead of asking a developer to
 * edit index.html. This exercises the actual form → upload/update/delete
 * → grid-refresh flow against a scripted admin-photo-manager backend.
 */
test.describe("Admin photo manager UI", () => {
  test("uploading a photo posts the right payload and refreshes the grid", async ({ page }) => {
    let listCallCount = 0;
    const uploadCalls = [];

    // mockAdminBackend() registers a generic **/.netlify/functions/**
    // catch-all — Playwright matches routes in reverse registration order,
    // so this specific override must be registered AFTER mockAdminBackend(),
    // not before, or the catch-all shadows it.
    await mockAdminBackend(page);
    await page.route("**/.netlify/functions/admin-photo-manager**", async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get("action");
      if (action === "list" && route.request().method() === "GET") {
        listCallCount += 1;
        const items =
          listCallCount === 1
            ? []
            : [
                {
                  id: "row-1",
                  context: "website_hero",
                  category: "Seasonal Picks",
                  name: "Autumn Admin Upload",
                  image_url: "/assets/website-studio/hero/signature-vase-lineup.jpg",
                  alt_text: "Autumn floral arrangement",
                },
              ];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
        return;
      }
      if (action === "upload" && route.request().method() === "POST") {
        uploadCalls.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ item: { id: "row-1" } }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await withFakeAdminSession(page);
    await page.goto("/admin");
    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
    await page.locator('aside nav button[data-view="floralLibraryAdmin"]').click();

    const root = page.locator("#photoManagerRoot");
    await expect(root.locator("h2")).toHaveText("Add real photos");
    await expect(root.locator(".photo-mgr-grid")).toContainText("No admin-uploaded photos yet");

    await root.locator("#photoMgrCategory").fill("Seasonal Picks");
    await root.locator("#photoMgrName").fill("Autumn Admin Upload");
    await root.locator("#photoMgrAltText").fill("Autumn floral arrangement");
    await root
      .locator("#photoMgrFile")
      .setInputFiles({ name: "autumn.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    await root.locator("#photoMgrSubmit").click();

    await expect(root.locator("#photoMgrStatus")).toHaveText("Photo added — live for every florist now.");
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].context).toBe("website_hero");
    expect(uploadCalls[0].category).toBe("Seasonal Picks");
    expect(uploadCalls[0].name).toBe("Autumn Admin Upload");
    expect(uploadCalls[0].dataUrl).toMatch(/^data:image\/png;base64,/);

    await expect(root.locator(".photo-mgr-card")).toHaveCount(1);
    await expect(root.locator(".photo-mgr-card h3")).toHaveText("Autumn Admin Upload");
  });

  test("the floral_library context shows price/recipe fields; website_hero hides them", async ({ page }) => {
    await mockAdminBackend(page);
    await page.route("**/.netlify/functions/admin-photo-manager**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }),
    );
    await withFakeAdminSession(page);
    await page.goto("/admin");
    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
    await page.locator('aside nav button[data-view="floralLibraryAdmin"]').click();

    const root = page.locator("#photoManagerRoot");
    await expect(root.locator("#photoMgrPriceField")).toBeHidden();
    await root.locator("#photoMgrContext").selectOption("floral_library");
    await expect(root.locator("#photoMgrPriceField")).toBeVisible();
    await expect(root.locator("#photoMgrRecipeField")).toBeVisible();
    await root.locator("#photoMgrContext").selectOption("website_hero");
    await expect(root.locator("#photoMgrPriceField")).toBeHidden();
  });

  test("editing an existing photo pre-fills the form and calls update, not upload", async ({ page }) => {
    const updateCalls = [];
    await mockAdminBackend(page);
    await page.route("**/.netlify/functions/admin-photo-manager**", async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get("action");
      if (action === "list" && route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "row-9",
                context: "floral_library",
                category: "Funeral",
                name: "Casket Spray",
                suggested_retail: 189.99,
                short_description: "Classic red and white spray",
                description: "",
                recipe: [{ name: "Red Roses", qty: 24 }],
                alt_text: "Red and white casket spray",
                image_url: "/assets/floral-library/funeral/fn-01.jpg",
              },
            ],
          }),
        });
        return;
      }
      if (action === "update" && route.request().method() === "POST") {
        updateCalls.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await withFakeAdminSession(page);
    await page.goto("/admin");
    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
    await page.locator('aside nav button[data-view="floralLibraryAdmin"]').click();

    const root = page.locator("#photoManagerRoot");
    await expect(root.locator(".photo-mgr-card")).toHaveCount(1);
    await root.locator('[data-edit-photo="row-9"]').click();

    await expect(root.locator("#photoMgrName")).toHaveValue("Casket Spray");
    await expect(root.locator("#photoMgrContext")).toHaveValue("floral_library");
    await expect(root.locator("#photoMgrPrice")).toHaveValue("189.99");
    await expect(root.locator("#photoMgrRecipe")).toHaveValue("Red Roses, 24");
    await expect(root.locator("#photoMgrSubmit")).toHaveText("Save changes");

    await root.locator("#photoMgrName").fill("Casket Spray — Deluxe");
    await root.locator("#photoMgrSubmit").click();

    await expect(root.locator("#photoMgrStatus")).toHaveText("Saved.");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe("row-9");
    expect(updateCalls[0].name).toBe("Casket Spray — Deluxe");
  });

  test("deleting a photo confirms, calls delete, and removes it from the grid", async ({ page }) => {
    let deleted = false;
    await mockAdminBackend(page);
    await page.route("**/.netlify/functions/admin-photo-manager**", async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get("action");
      if (action === "list" && route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: deleted
              ? []
              : [
                  {
                    id: "row-2",
                    context: "website_hero",
                    category: "Signature",
                    name: "Blush Lavender Macro",
                    alt_text: "Blush and lavender macro shot",
                    image_url: "/assets/website-studio/hero/signature-blush-lavender-macro.jpg",
                  },
                ],
          }),
        });
        return;
      }
      if (action === "delete" && route.request().method() === "POST") {
        deleted = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await withFakeAdminSession(page);
    await page.goto("/admin");
    page.on("dialog", (dialog) => dialog.accept());
    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
    await page.locator('aside nav button[data-view="floralLibraryAdmin"]').click();

    const root = page.locator("#photoManagerRoot");
    await expect(root.locator(".photo-mgr-card")).toHaveCount(1);
    await root.locator('[data-delete-photo="row-2"]').click();

    await expect(root.locator("#photoMgrStatus")).toHaveText("Photo deleted.");
    await expect(root.locator(".photo-mgr-card")).toHaveCount(0);
    await expect(root.locator(".photo-mgr-grid")).toContainText("No admin-uploaded photos yet");
  });
});
