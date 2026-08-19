import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for a real bug: the off-canvas sidebar drawer
 * (public/index.html #atelierSidebarDrawer) is a flex-direction:column
 * layout, but a legacy rule from bloom-rc2-design-system.css
 * (`body.bloom-rc2 aside { flex-wrap: wrap }` inside
 * @media(max-width:900px), written for the old horizontal chip-style
 * mobile nav) was never neutralized for the modern drawer. Nothing in
 * florisyn-mobile-shell.css ever set flex-wrap back to nowrap, so
 * column + wrap made the browser start a new *column* the instant nav
 * content ran taller than the drawer — shoving the nav to the right of
 * the "Florisyn" brand row and off the visible edge, clipping labels
 * like "Payment Centre" mid-word on both narrow-desktop (<980px) and
 * phone-width viewports. Fixed by setting flex-wrap:nowrap !important
 * on the drawer in florisyn-mobile-shell.css.
 *
 * This asserts every nav label renders fully inside the drawer's own
 * right edge, at a phone width and at a narrow-desktop width (both
 * below the 980px breakpoint where the off-canvas drawer applies).
 */
for (const width of [390, 900]) {
  test(`sidebar drawer nav items never overflow the drawer's edge at ${width}px`, async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const menuToggle = page.locator("#atelierMenuToggle");
    await menuToggle.click();
    await page.waitForTimeout(400);

    const drawer = page.locator("#atelierSidebarDrawer");
    await expect(drawer).toBeVisible();

    const overflowing = await page.evaluate(() => {
      const aside = document.getElementById("atelierSidebarDrawer");
      const asideRight = aside.getBoundingClientRect().right;
      return [...aside.querySelectorAll(".florisyn-lux-nav > button[data-page]")]
        .filter((btn) => !btn.hidden)
        .map((btn) => ({ label: btn.textContent.trim(), right: btn.getBoundingClientRect().right }))
        .filter((item) => item.right > asideRight + 1);
    });

    expect(overflowing, `nav labels clipped past the drawer edge: ${JSON.stringify(overflowing)}`).toEqual([]);

    // Also confirm the drawer's own flex-wrap didn't regress back to "wrap"
    // (the direct cause) — belt and suspenders alongside the overflow check.
    const flexWrap = await drawer.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe("nowrap");
  });
}
