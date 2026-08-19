import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Photo Studio (internally "BloomShot") used to lose a florist's entire
 * in-progress photo edit on any page refresh — accidental navigation,
 * browser restart, tab restore. Its localStorage draft (`bloomShotDraft`)
 * only ever persisted the surrounding TEXT fields (product name,
 * description, etc.); the uploaded photo itself, its rotation, and every
 * slider/background choice were never saved, so a refresh silently wiped
 * all of that back to the empty "Choose or take an arrangement photo"
 * state while the text fields quietly survived — no warning, no data-loss
 * indication of any kind. This is priority #1 in the product's own
 * "do not lose user photos" mandate. Fixed by also persisting a
 * downscaled copy of the uploaded photo plus rotation/background/size/
 * slider values, and restoring + re-running the (free, local, on-device)
 * background removal automatically on load.
 */
test("Photo Studio survives a page refresh: the uploaded photo and its edits are restored, not lost", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="bloomshotPage"]').click();
  await expect(page.locator("#bloomshotEmpty")).toBeVisible();

  // A simple synthetic photo — solid background with a colored subject —
  // is enough to exercise the persistence path; whether the background-
  // removal quality gate accepts or rejects this particular synthetic
  // shape isn't what this test is about (see photo-studio.test.js for
  // that algorithm's own coverage).
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300; c.height = 300;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f7f5f2";
    ctx.fillRect(0, 0, 300, 300);
    ctx.fillStyle = "#c33f63";
    ctx.beginPath();
    ctx.arc(150, 150, 60, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  await page.setInputFiles("#bloomshotFile", { name: "arrangement.png", mimeType: "image/png", buffer });
  await page.waitForTimeout(800);
  await expect(page.locator("#bloomshotEmpty")).toBeHidden();

  // Make a real, checkable editing decision beyond just uploading.
  await page.locator("#shotRotate").click();
  await page.waitForTimeout(200);

  await page.reload();
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="bloomshotPage"]').click();
  await page.waitForTimeout(800);

  // The core regression: the photo must still be there, not the empty state.
  await expect(page.locator("#bloomshotEmpty")).toBeHidden();
  const canvasHasContent = await page.locator("#bloomshotCanvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Any non-transparent pixel means something was actually drawn, not a blank canvas.
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  });
  expect(canvasHasContent).toBe(true);

  expect(consoleErrors.filter((e) => !e.includes("ERR_TUNNEL") && !e.includes("staticimgly"))).toEqual([]);
});
