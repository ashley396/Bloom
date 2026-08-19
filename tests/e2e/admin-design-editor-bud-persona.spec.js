import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Bud joined Lily, Rose, and Daisy as a 4th assistant persona, but the
 * admin's "UI Design Mode" character text/voice editor still had a
 * hardcoded 3-persona list — admins had no card to edit Bud's display
 * name/title/blurb, and no way to upload a custom voice sample for him,
 * unlike his three siblings. Verifies Bud now gets a card in both panels.
 */
test("UI Design Mode's character and voice editors include a Bud card", async ({ page }) => {
  await mockAdminBackend(page);
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });

  await page.locator('aside nav button[data-view="uiDesignMode"]').click();
  await expect(page.locator("#uiDesignModeView")).toHaveClass(/active/);

  await expect(page.locator('[data-character-card="Bud"]')).toBeVisible();
  await expect(page.locator('[data-character-card="Lily"]')).toBeVisible();
  await expect(page.locator('[data-voice-card="Bud"]')).toBeVisible();
  await expect(page.locator('[data-voice-card="Daisy"]')).toBeVisible();
});
