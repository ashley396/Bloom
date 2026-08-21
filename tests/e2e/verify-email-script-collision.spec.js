import { test, expect } from "@playwright/test";

/**
 * Confirmed regression, found by the launch-repair smoke sweep
 * (launch-smoke-30-routes.spec.js): verify-email.html loads verify-email.js
 * and bloom-auth-common.js as two sibling classic <script> tags. Both
 * declared their own top-level `const params = new URLSearchParams(...)`.
 * Classic scripts share one global lexical scope, so the second script's
 * declaration collided with the first's — "Identifier 'params' has
 * already been declared" — a real SyntaxError that aborted the entire
 * second script (bloom-auth-common.js) before any of its code ran. That
 * silently broke the page's "© <year> Florisyn Technologies" footer stamp
 * (bloom-auth-common.js's [data-current-year] fill never executed), on
 * top of the console error itself. Fixed by renaming
 * bloom-auth-common.js's own binding so it can't collide with any host
 * page's script.
 */
test.describe("verify-email.html: no script-collision regression", () => {
  test("loads with no uncaught script error and the footer year actually fills in", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/verify-email");

    expect(pageErrors).toEqual([]);
    const year = await page.locator("[data-current-year]").textContent();
    expect(year).toBe(String(new Date().getFullYear()));
  });
});
