import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * mountPersonaPanel() in assistant-voice.js used to compute
 * id="lilyVoicePanel" for any persona that wasn't "Rose" — so once
 * Lily's own panel existed, calling it for Bud found that id already
 * taken and silently skipped, even though the section heading already
 * said "LILY, ROSE & BUD". Verifies all three voice panels actually
 * render in Settings.
 */
test("Settings renders a voice panel for Lily, Rose, and Bud — not just two of the three", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("settingsPage"));
  // Settings reorganization (UX cleanup Part C): assistant voice settings
  // moved out of the Branding panel into the "AI & Assistants" tab.
  await page.locator('#settingsPage [data-settings-tab="ai"]').click();

  await expect(page.locator("#lilyVoicePanel")).toBeVisible();
  await expect(page.locator("#roseVoicePanel")).toBeVisible();
  await expect(page.locator("#budVoicePanel")).toBeVisible();
  await expect(page.locator("#budVoicePanel")).toContainText("BUD VOICE");
});
