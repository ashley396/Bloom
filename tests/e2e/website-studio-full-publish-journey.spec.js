import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";
import { buildPublishChecklist } from "../../lib/website-studio/publish-checklist.js";

/**
 * WBX Step 9: a full, realistic user journey through the actual publish
 * pipeline — not another isolated-component check, but the seam between
 * them: add real content (using the section type just unlocked in Step
 * 8), save, hit the real commerce-safety checklist gate on a
 * still-incomplete site (no products yet, no SEO configured — the
 * honest state of a brand-new shop's first day), see exactly what's
 * blocking, choose to publish anyway, and land on a genuinely published
 * state. Uses the real buildPublishChecklist() (imported, not
 * hand-faked) so the mock's pass/fail behavior matches production
 * exactly — same discipline as reorder_sections in the drag-reorder
 * spec.
 */

function buildState() {
  return {
    project: { id: "proj-1", status: "draft", commerce_settings: {}, seo_settings: {} },
    pages: [
      {
        id: "page-home",
        slug: "home",
        title: "Home",
        visible: true,
        sections: [
          { id: "sec-hero", type: "hero", order: 0, props: { title: "Lilies in Bloom" } },
          { id: "sec-featured", type: "featured_arrangements", order: 1, props: { title: "Featured" } },
        ],
        updated_at: new Date().toISOString(),
      },
      { id: "page-shop", slug: "shop", title: "Shop", visible: true, sections: [], updated_at: new Date().toISOString() },
      { id: "page-contact", slug: "contact", title: "Contact", visible: true, sections: [], updated_at: new Date().toISOString() },
    ],
    // Deliberately the honest state of a brand-new shop: phone on file,
    // but zero products published and no SEO configured yet — this is
    // what should actually block a first publish attempt.
    shop: { phone: "555-0100" },
    products: [],
  };
}

test("full journey: add real content, save, hit the checklist gate, publish anyway, land published", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);

  const state = buildState();

  await page.route("**/.netlify/functions/instant-website", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");

    if (body.action === "get_project") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: state.project, pages: state.pages }) });
    }

    if (body.action === "save_page") {
      const idx = state.pages.findIndex((p) => p.slug === body.page.slug);
      const saved = { ...state.pages[idx], ...body.page, updated_at: new Date().toISOString() };
      state.pages[idx] = saved;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, page: saved }) });
    }

    if (body.action === "publish_checklist" || body.action === "publish") {
      const checklist = buildPublishChecklist({
        project: state.project,
        pages: state.pages,
        products: state.products,
        commerce: state.project.commerce_settings,
        shop: state.shop,
        seo: state.project.seo_settings,
      });

      if (body.action === "publish_checklist") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ready: checklist.ready, kpis: checklist.kpis, items: checklist.items }),
        });
      }

      if (!checklist.ready && !body.override_checklist) {
        const failing = checklist.items.filter((i) => !i.optional && !i.pass);
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: `This site isn't ready to publish yet: ${failing.map((i) => i.label).join("; ")}.`,
            code: "checklist_blocked",
            items: failing,
          }),
        });
      }

      state.project.status = "published";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ published: true, status: "published", project_id: state.project.id }) });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Accept the real "site isn't ready — publish anyway?" confirm() the
  // Editor shows — that's the actual UX for this exact scenario, not a
  // shortcut around it.
  let confirmMessage = "";
  page.on("dialog", async (dialog) => {
    confirmMessage = dialog.message();
    await dialog.accept();
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();

  const canvas = page.locator("#editorCanvas");
  await expect(canvas.locator(".editor-section")).toHaveCount(2);

  // Add real testimonial content — the capability shipped in WBX Step 8 —
  // as part of actually building out the site, not as an isolated check.
  await page.locator("#editorSectionType").selectOption("testimonials");
  await page.locator("#editorAddSection").click();
  await expect(canvas.locator(".editor-section")).toHaveCount(3);

  const newCard = canvas.locator('.editor-section[data-id^="testimonials-"]');
  await newCard.click();
  await page.locator('#editorInspector textarea[data-prop="items"]').fill("Beautiful, on time, every time. — Jordan");

  await page.locator("#editorSave").click();
  await expect(page.locator("#editorStatus")).toHaveText(/Draft saved|saved/i, { timeout: 5_000 });

  await page.locator("#editorPublish").click();

  // The checklist-blocked confirm dialog fired with the real, specific
  // reasons — not a generic "something's wrong."
  await expect.poll(() => confirmMessage).toContain("products");
  expect(confirmMessage).toContain("SEO");

  await expect(page.locator("#editorStatus")).toHaveText("Website published.", { timeout: 5_000 });
  expect(state.project.status).toBe("published");

  // The first publish attempt is *meant* to come back 409 (that's the
  // checklist gate firing) — Chromium logs a "Failed to load resource"
  // console line for any non-2xx fetch response regardless of whether the
  // app handled it, same as the documented blockExternalCalls() note in
  // smoke.spec.js. That one expected line isn't a real error; anything
  // else still fails the test.
  const unexpectedErrors = consoleErrors.filter((e) => !/Failed to load resource.*409/.test(e));
  expect(unexpectedErrors).toEqual([]);
});

test("publish succeeds cleanly with no confirm dialog when the checklist is already satisfied", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);

  const state = buildState();
  // A fully ready site: enough sections, three published products with
  // alt-texted images, real SEO copy.
  state.pages[0].sections.push({ id: "sec-about", type: "about_florist", order: 2, props: { title: "About", text: "Family-owned since 1998." } });
  state.project.seo_settings = { title: "Lilies in Bloom — Florist in Prestonsburg, KY", meta_description: "Same-day flower delivery and custom arrangements from a local, family-owned florist in Prestonsburg, Kentucky." };
  state.products = Array.from({ length: 3 }, (_, i) => ({
    publish_status: "published",
    sync: { available_online: true },
    primary_image: { url: `https://example.com/p${i}.jpg`, alt: `Arrangement ${i}` },
  }));

  await page.route("**/.netlify/functions/instant-website", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.action === "get_project") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: state.project, pages: state.pages }) });
    }
    if (body.action === "save_page") {
      const idx = state.pages.findIndex((p) => p.slug === body.page.slug);
      state.pages[idx] = { ...state.pages[idx], ...body.page, updated_at: new Date().toISOString() };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, page: state.pages[idx] }) });
    }
    if (body.action === "publish") {
      const checklist = buildPublishChecklist({
        project: state.project,
        pages: state.pages,
        products: state.products,
        commerce: state.project.commerce_settings,
        shop: state.shop,
        seo: state.project.seo_settings,
      });
      expect(checklist.ready).toBe(true);
      state.project.status = "published";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ published: true, status: "published", project_id: state.project.id }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();
  await expect(page.locator("#editorCanvas .editor-section")).toHaveCount(3);

  await page.locator("#editorPublish").click();
  await expect(page.locator("#editorStatus")).toHaveText("Website published.", { timeout: 5_000 });

  expect(dialogFired).toBe(false);
  expect(consoleErrors).toEqual([]);
});
