import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Website Studio's "Editor" tab stacked two independently-built, fully
 * real, correctly-coordinated modules — website-studio-v2.js (pages list,
 * a read-only live-preview iframe, SEO/domain settings) and
 * website-editor-ui.js (the actual editable section canvas + properties
 * inspector) — as two full-width cards, BOTH headed "VISUAL EDITOR". A
 * florist had no way to tell which one was the real editor. Verifies:
 * only one panel is labeled "VISUAL EDITOR" (the real section editor),
 * v2's iframe preview is relabeled to say what it actually is, and the
 * real editor's canvas/inspector split gets real width instead of being
 * squeezed inside v2's narrow middle column (an earlier draft of this
 * fix collapsed it to ~96px, breaking words mid-letter).
 */
test("Website Studio's Editor tab has exactly one 'VISUAL EDITOR' panel, not two", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();
  await expect(page.locator(".website-editor-shell")).toBeVisible();

  const eyebrows = await page.locator("#wsPanel-editor p.eyebrow", { hasText: /^VISUAL EDITOR$/ }).allTextContents();
  expect(eyebrows).toHaveLength(1);
  await expect(page.locator(".ws2-panel-canvas p.eyebrow")).toHaveText("READ-ONLY PREVIEW");

  // The real editor's canvas/inspector split has real width, not
  // squeezed into a few dozen pixels by being nested inside v2's own
  // narrow middle grid column.
  const canvasWidth = await page.locator("#editorCanvas").evaluate((el) => el.getBoundingClientRect().width);
  expect(canvasWidth).toBeGreaterThan(300);

  expect(consoleErrors).toEqual([]);
});
