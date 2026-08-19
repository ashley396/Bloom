import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * "Launch checklist" only reads readiness — it calls the publish_checklist
 * action, a pure read-only check, and never touches publish state. But it
 * was styled class="primary", the same dark CTA pill as the real "Publish
 * (approved)" button in the section editor below it, so a florist had no
 * visual cue that one of these two similarly-worded, similarly-styled
 * buttons actually makes the site live and the other doesn't touch
 * anything. Verifies the Editor tab has exactly one primary (dark) button
 * — the real Publish — and Launch checklist is now secondary.
 */
test("Website Studio's Editor tab has exactly one primary call-to-action — Publish, not Launch checklist", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();
  await expect(page.locator(".website-editor-shell")).toBeVisible();

  const panel = page.locator("#wsPanel-editor");
  await expect(panel.locator("button.primary")).toHaveCount(1);
  await expect(panel.locator("button.primary")).toHaveText("Publish (approved)");

  const checklistBtn = panel.locator("#ws2RunChecklist");
  await expect(checklistBtn).toHaveClass(/secondary/);
  await expect(checklistBtn).not.toHaveClass(/primary/);
});
