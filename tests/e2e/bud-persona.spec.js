import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Bud — Florisyn's problem-solving persona — lives in the same chat
 * drawer as Lily, Rose, and Daisy. Verifies he actually shows up in the
 * persona picker and that switching to him updates every piece of chrome
 * (avatar, name, tag, placeholder, and the voice-preview button's title —
 * which was previously hardcoded to always say "Hear Lily" regardless of
 * the active persona).
 */
test("Bud appears in the persona picker and switching to him updates the panel chrome", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  const budButton = page.locator('[data-lily-persona="bud"]');
  await expect(budButton).toBeVisible();
  await expect(budButton).toContainText("Bud");

  await budButton.click();

  await expect(page.locator("#lilyHeadName")).toHaveText("Bud");
  await expect(page.locator("#lilyHeadTag")).toHaveText("Something broken?");
  await expect(page.locator("#lilyHeadAvatar")).toHaveAttribute("src", "/assets/assistants/bud-portrait.webp");
  await expect(page.locator("#lilyInput")).toHaveAttribute("placeholder", "Tell Bud what's not working…");
  await expect(page.locator(".lily-voice")).toHaveAttribute("title", "Hear Bud");
});
