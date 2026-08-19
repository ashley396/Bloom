import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * WBX highest-value gap, closed: the storefront renderer
 * (lib/storefront/section-renderer.js) has always known how to render
 * testimonials, FAQ, Instagram, newsletter, map, announcement bar, and
 * seasonal sections — a florist just had no way to add one, since the
 * Editor's "Add section" dropdown only ever offered the original 10
 * types. This exercises the real, added, browser-side fix end to end:
 * add a Testimonials section, select it, type real quotes into the new
 * inspector field, and confirm they round-trip back into the field
 * (proving website-section-inspector.js's new getVal/setVal handling
 * for testimonials/faq actually works, not just the lib/ copy the unit
 * tests cover).
 */

const HOME_PAGE = {
  id: "page-home",
  slug: "home",
  title: "Home",
  sections: [{ id: "sec-hero", type: "hero", order: 0, props: { title: "Welcome" } }],
  updated_at: new Date().toISOString(),
};

test("adding a Testimonials section from the Editor lets a florist actually write and keep real quotes", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);

  await page.route("**/.netlify/functions/instant-website", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.action === "get_project") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ project: { status: "draft" }, pages: [HOME_PAGE] }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();

  const canvas = page.locator("#editorCanvas");
  await expect(canvas.locator(".editor-section")).toHaveCount(1);

  // The dropdown genuinely offers Testimonials now — not just present in
  // markup, but selectable and addable.
  await page.locator("#editorSectionType").selectOption("testimonials");
  await page.locator("#editorAddSection").click();
  await expect(canvas.locator(".editor-section")).toHaveCount(2);

  const newCard = canvas.locator('.editor-section[data-id^="testimonials-"]');
  await expect(newCard).toHaveCount(1);
  await newCard.click();

  const quotesField = page.locator('#editorInspector textarea[data-prop="items"]');
  await expect(quotesField).toBeVisible();

  const quoteText = "Gorgeous arrangement, arrived early. — Morgan\nBest florist in town. — Casey";
  await quotesField.fill(quoteText);
  // Blur to a neutral element so the input event has definitely committed
  // before re-reading the field.
  await page.locator("#editorStatus").click({ force: true }).catch(() => {});

  // Re-select a different section, then come back — this forces
  // renderPanel() to rebuild the inspector from the actual section state
  // (not just whatever the textarea happened to still show), proving the
  // typed quotes were really parsed into section.props.items and not lost.
  await canvas.locator(".editor-section").first().click();
  await newCard.click();

  const quotesFieldAfterReselect = page.locator('#editorInspector textarea[data-prop="items"]');
  await expect(quotesFieldAfterReselect).toHaveValue(quoteText);

  expect(consoleErrors).toEqual([]);
});

test("Editor's Add-section dropdown lists every renderer-supported type a florist can now add", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.route("**/.netlify/functions/instant-website", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: { status: "draft" }, pages: [HOME_PAGE] }),
    }),
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();

  const options = await page.locator("#editorSectionType option").evaluateAll((els) => els.map((el) => el.getAttribute("value")));
  for (const type of ["testimonials", "faq", "instagram", "map", "newsletter", "announcement_bar", "seasonal_banner", "custom_text_image"]) {
    expect(options, `"${type}" should be selectable in Add section`).toContain(type);
  }
});
