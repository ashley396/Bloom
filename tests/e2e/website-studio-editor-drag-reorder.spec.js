import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";
import { reorderSections } from "../../netlify/functions/_shared/bloom-instant-website.js";

const SECTIONS = [
  { id: "sec-hero", type: "hero", order: 0, props: { title: "Welcome" } },
  { id: "sec-featured", type: "featured_arrangements", order: 1, props: { title: "Featured" } },
  { id: "sec-about", type: "about_florist", order: 2, props: { title: "About" } },
];

const HOME_PAGE = {
  id: "page-home",
  slug: "home",
  title: "Home",
  sections: SECTIONS,
  updated_at: new Date().toISOString(),
};

/**
 * The editor canvas's section reordering used to make the whole card
 * draggable="true", including its buttons and its contenteditable text —
 * so selecting text inside a section risked starting a whole-card HTML5
 * drag instead, and dropping gave no indication of where the section
 * would actually land (it just swapped into whatever card you released
 * over). Now only the small ⠿ handle in each section's toolbar is
 * draggable, and a visible insertion line shows above or below whichever
 * card is under the pointer depending on which half of it the pointer is
 * over. Drag events are dispatched synthetically (real DataTransfer, real
 * Chromium DOM) rather than via OS-level drag simulation, so this
 * exercises the app's actual dragstart/dragover/drop listeners directly.
 */
test("dragging a section by its handle shows an insertion line and reorders correctly on drop", async ({ page }) => {
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
    if (body.action === "reorder_sections") {
      // Real production reorder logic, not a hand-rolled mock — same
      // fidelity discipline as the other fixtures built this session.
      const sections = reorderSections(body.sections || [], Number(body.from), Number(body.to));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#wsTab-editor").click();

  const canvas = page.locator("#editorCanvas");
  await expect(canvas.locator(".editor-section")).toHaveCount(3);
  await expect(canvas.locator(".editor-section")).toHaveCount(3);
  const initialOrder = await canvas.locator(".editor-section").evaluateAll((els) => els.map((el) => el.dataset.id));
  expect(initialOrder).toEqual(["sec-hero", "sec-featured", "sec-about"]);

  // Drag the hero card (index 0) and drop it in the *bottom* half of the
  // featured-arrangements card (index 1) — i.e. "insert after featured",
  // which should land it between featured and about.
  const result = await canvas.evaluate(() => {
    const articles = [...document.querySelectorAll("#editorCanvas .editor-section")];
    const source = articles[0];
    const target = articles[1];
    const handle = source.querySelector(".editor-drag-handle");
    const rect = target.getBoundingClientRect();
    const dt = new DataTransfer();

    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const draggingMidGesture = source.classList.contains("dragging");

    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom - 5, // bottom half → insert AFTER target
      }),
    );
    const indicatorMidGesture = { before: target.classList.contains("drop-before"), after: target.classList.contains("drop-after") };

    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom - 5,
      }),
    );
    handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));

    return { draggingMidGesture, indicatorMidGesture };
  });

  expect(result.draggingMidGesture).toBe(true);
  expect(result.indicatorMidGesture).toEqual({ before: false, after: true });

  await expect(canvas.locator(".editor-section.dragging")).toHaveCount(0);
  await expect(canvas.locator(".editor-section.drop-before, .editor-section.drop-after")).toHaveCount(0);

  const finalOrder = await canvas.locator(".editor-section").evaluateAll((els) => els.map((el) => el.dataset.id));
  expect(finalOrder).toEqual(["sec-featured", "sec-hero", "sec-about"]);

  expect(consoleErrors).toEqual([]);
});
