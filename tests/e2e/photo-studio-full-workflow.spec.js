import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * End-to-end coverage for Photo Studio's complete workflow. Before this,
 * the feature had zero e2e coverage — only source-text regex tests
 * (asserting app.js *contains* certain strings) and pure-algorithm unit
 * tests for the background-removal engine. Neither kind actually clicks
 * a button in a real browser, so a real DOM/wiring regression (a broken
 * selector, a listener that silently doesn't fire, a value that never
 * reaches the canvas) could ship undetected. This drives the real UI
 * through every control a florist would use in one session, the same way
 * they would: upload → style it → ask Lily → save → post → tidy up.
 */

async function uploadSyntheticPhoto(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f7f5f2";
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = "#4a7c3f";
    ctx.fillRect(190, 250, 10, 120);
    ctx.fillRect(210, 250, 10, 120);
    ctx.fillStyle = "#c33f63";
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.arc(200 + Math.cos(i) * 50, 180 + Math.sin(i) * 50, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    return c.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  await page.setInputFiles("#bloomshotFile", { name: "arrangement.png", mimeType: "image/png", buffer });
  await page.waitForTimeout(1000);
}

async function mockPhotoStudioApis(page) {
  await page.route("**/.netlify/functions/**", async (route) => {
    const url = route.request().url();
    if (url.includes("photo-recipe")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          recipe: [
            { name: "Pink Rose", qty: 5, kind: "focal" },
            { name: "Eucalyptus", qty: 3, kind: "greenery" },
          ],
          stems: 8,
          design_notes: "Romantic round bouquet.",
        }),
      });
    }
    if (url.includes("ai-assistant")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            description: "A lovely hand-tied arrangement.",
            caption: "Fresh flowers today!",
            seo: "Pink Rose Bouquet",
            alt: "Pink roses and eucalyptus bouquet",
          },
          provider: "test",
        }),
      });
    }
    if (url.includes("products")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "prod-123", name: "Test" }, items: [] }) });
    }
    if (url.includes("florist-community")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, post: { id: "post-1" } }) });
    }
    if (url.includes("recipes")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test.describe("Photo Studio full workflow", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await mockPhotoStudioApis(page);
    await withFakeSession(page);
    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="bloomshotPage"]').click();
    await expect(page.locator("#bloomshotEmpty")).toBeVisible();
  });

  test("upload shows the photo and clears the empty state", async ({ page }) => {
    await uploadSyntheticPhoto(page);
    await expect(page.locator("#bloomshotEmpty")).toBeHidden();
    await expect(page.locator("#shotStatus")).not.toHaveText("");
  });

  test("style controls (presets, sliders, canvas size, background, rotate) all apply without error", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await uploadSyntheticPhoto(page);

    for (const preset of ["clean", "luxury", "warm", "true"]) {
      await page.locator(`[data-shot-preset="${preset}"]`).click();
    }
    await page.locator("#shotBrightness").fill("120");
    await page.locator("#shotContrast").fill("110");
    const outputs = await page.locator(".bloomshot-controls output").allTextContents();
    expect(outputs).toContain("120%");
    expect(outputs).toContain("110%");

    // The wide hero format exists and actually resizes the canvas — added
    // specifically because every prior size option was square/portrait,
    // with no landscape option for Website Studio X hero banners.
    await page.locator("#shotSize").selectOption({ label: "Website hero (16:9)" });
    const heroDims = await page.locator("#bloomshotCanvas").evaluate((c) => ({ w: c.width, h: c.height }));
    expect(heroDims).toEqual({ w: 1920, h: 1080 });

    await page.locator("#shotBackground").selectOption("luxury-emerald");
    await page.locator("#shotWatermark").fill("Rose & Co");
    await page.locator("#shotRotate").click();

    expect(pageErrors).toEqual([]);
  });

  test("Lily's recipe builder and content drafting both populate real output", async ({ page }) => {
    await uploadSyntheticPhoto(page);

    await page.locator("#shotRecipe").click();
    await expect(page.locator("#shotRecipeOut")).toBeVisible();
    await expect(page.locator("#shotRecipeOut")).toContainText("Pink Rose");

    await page.locator("#shotProductName").fill("Pink Rose Garden");
    await page.locator("#shotGenerate").click();
    await expect(page.locator("#shotDescription")).not.toHaveValue("");
  });

  test("save to Products and Post both require approval and report a real outcome", async ({ page }) => {
    await uploadSyntheticPhoto(page);
    await page.locator("#shotProductName").fill("Pink Rose Garden");

    // Approval gate: nothing happens without it.
    await page.locator("#shotAddProduct").click();
    await expect(page.locator("#shotStatus")).not.toContainText("Saved to Products");

    await page.locator("#shotApproved").check();
    await page.locator("#shotAddProduct").click();
    await expect(page.locator("#shotStatus")).toContainText("Saved to Products");

    await page.locator("#shotPostWebsite").check();
    await page.locator("#shotPostCommunity").check();
    await page.locator("#shotPost").click();
    await expect(page.locator("#shotStatus")).toContainText("Posted to");
  });

  test("download, restore original, and remove photo all work", async ({ page }) => {
    await uploadSyntheticPhoto(page);

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#bloomshotDownload").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);

    await page.locator("#bloomshotRestore").click();
    await expect(page.locator("#bloomshotEmpty")).toBeHidden();

    await page.locator("#bloomshotRemovePhoto").click();
    await expect(page.locator("#bloomshotEmpty")).toBeVisible();
  });
});
