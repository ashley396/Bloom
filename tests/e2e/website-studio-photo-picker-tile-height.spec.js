import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Website Studio X's "Real floral photography" picker (public/index.html,
 * .image-picker.photo-gallery) collapsed every photo tile from its
 * intended 150px min-height down to 44px, because
 * bloom-rc2-design-system.css's global tap-target floor —
 * `body.bloom-rc2 button{min-height:44px}` — has HIGHER CSS specificity
 * (1 class + 2 elements) than the picker's own `.photo-gallery
 * button{min-height:150px}` (1 class + 1 element), and specificity beats
 * source order regardless of which stylesheet loads later. With tiles
 * squashed to 44px, each tile's absolutely-positioned caption (anchored
 * bottom:8px) visually bled into the tile below it, and there was no
 * room left to see the actual photo. Fixed by qualifying the selector
 * with both classes the container actually carries
 * (class="image-picker photo-gallery"), which is real markup, not a
 * specificity hack, and cleanly wins (2 classes beats 1 regardless of
 * element count).
 */
test("Website Studio's photo picker tiles keep their full 150px height, not the 44px tap-target floor", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-brand").click();

  const gallery = page.locator(".image-picker.photo-gallery");
  const firstTile = gallery.locator("button").first();
  await expect(firstTile).toBeVisible();

  const height = await firstTile.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(150);

  // Two tiles in the same grid column, stacked vertically, must not
  // overlap — the original bug had the second tile's caption bleeding
  // into the first tile's box.
  const tiles = gallery.locator("button");
  const box0 = await tiles.nth(0).boundingBox();
  const box2 = await tiles.nth(2).boundingBox(); // 2-column grid: index 2 is directly below index 0
  expect(box2.y).toBeGreaterThanOrEqual(box0.y + box0.height);
});
