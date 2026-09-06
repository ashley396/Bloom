import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Live beta defect fix (2026-09-05): Ashley reported the Marketing Studio
 * "Create draft" button was unreliable — a normal single click frequently
 * appeared to do nothing, requiring several clicks before the request
 * visibly submitted. A read-only forensic trace (against the real staging
 * data — see the session's own report) proved the root cause precisely:
 * load() always did `state.loading = true; render()` before its five
 * parallel network calls, and render() replaced the ENTIRE Marketing
 * Studio panel with a bare "Loading Marketing Studio…" placeholder that
 * contains no form and no button at all. Because load() reruns after
 * every single create/generate/revise/approve action (and every time the
 * Marketing Studio nav tab is reactivated), a click landing during any of
 * those windows hit nothing — not a disabled button, literally no button.
 *
 * These tests drive the REAL public/marketing-studio-shop-ui.js script
 * (never a simplified stand-in) with realistic artificial network latency
 * on the mocked backend, proving the render-lifecycle fix: the create-item
 * form is mounted exactly once and never destroyed by a later background
 * refresh, a click on it gets immediate synchronous visible feedback, and
 * rapid repeated clicks can never produce more than one real submission.
 */

const NETWORK_DELAY_MS = 700;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a stateful mock of marketing-studio-shop's own actions. `items`
 * is a live, mutable array this function reads/writes so a test can
 * observe the effect of create_content_item across a later list_content
 * refresh — exactly how the real backend and the real UI actually behave
 * together, not a static fixture.
 */
async function mockMarketingStudioShop(page, { items = [], listContentDelayAfterFirstCall = 0, failListContentAfterFirstCall = false } = {}) {
  await mockBackend(page);
  let listContentCalls = 0;
  let createContentItemCalls = 0;
  let generateContentCalls = 0;
  const created = [];
  await page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    if (action === "status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marketing_studio_enabled: true, note: "" }) });
      return;
    }
    if (action === "list_content") {
      listContentCalls += 1;
      if (listContentCalls > 1) {
        if (failListContentAfterFirstCall) {
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Temporary backend error." }) });
          return;
        }
        if (listContentDelayAfterFirstCall) await delay(listContentDelayAfterFirstCall);
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [...items, ...created] }) });
      return;
    }
    if (["get_brand_brain", "get_visual_style", "usage_summary", "connections"].includes(action)) {
      if (listContentCalls >= 1 && listContentDelayAfterFirstCall) await delay(listContentDelayAfterFirstCall);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    if (action === "create_content_item") {
      createContentItemCalls += 1;
      const body = JSON.parse(route.request().postData() || "{}");
      const id = `new-item-${createContentItemCalls}`;
      created.push({ id, content_type: "image_post", title: body.brief, brief: body.brief, status: "idea" });
      await delay(NETWORK_DELAY_MS);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id } }) });
      return;
    }
    if (action === "generate_content") {
      generateContentCalls += 1;
      const body = JSON.parse(route.request().postData() || "{}");
      const item = [...items, ...created].find((it) => it.id === body.content_item_id);
      if (item) item.status = "draft";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ asset: { id: "asset-1", type: "image" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return {
    counts: () => ({ listContentCalls, createContentItemCalls, generateContentCalls }),
    created
  };
}

async function openMarketingStudioShop(page) {
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingStudioPage"]').click();
  const root = page.locator("#marketingStudioRoot");
  await expect(root.locator("#msCreateItemForm")).toBeVisible();
  return root;
}

test("the create-item form stays visible and usable while a background page-data refresh is in flight", async ({ page }) => {
  const mock = await mockMarketingStudioShop(page, { listContentDelayAfterFirstCall: NETWORK_DELAY_MS });
  const root = await openMarketingStudioShop(page);

  await root.locator('textarea[name="brief"]').fill("A cute post about buying yourself flowers.");
  await root.locator('#msCreateItemForm button[type="submit"]').click();

  // The submit itself triggers create_content_item -> generate_content ->
  // load() (a background refresh whose own list_content/status/etc. calls
  // are all artificially delayed above). The create form must remain
  // visible and present for the entire duration of that refresh — the
  // proven real defect was exactly this window replacing the whole panel
  // with a bare "Loading…" placeholder that has no form in it at all.
  await expect(root.locator("#msCreateItemForm")).toBeVisible();
  await expect(root.locator("text=Loading Marketing Studio…")).toHaveCount(0);

  // Let everything settle, then confirm the new draft actually landed.
  await expect(root.locator('[data-ms-item="new-item-1"]')).toBeVisible({ timeout: 5000 });
  expect(mock.counts().createContentItemCalls).toBe(1);
});

test("one click immediately disables Create Draft and shows visible feedback, before the network call resolves", async ({ page }) => {
  await mockMarketingStudioShop(page);
  const root = await openMarketingStudioShop(page);
  const submitBtn = root.locator('#msCreateItemForm button[type="submit"]');

  await root.locator('textarea[name="brief"]').fill("A cute post about buying yourself flowers.");
  await submitBtn.click();

  // create_content_item is deliberately delayed (NETWORK_DELAY_MS) above —
  // while it's still in flight, the button must already read as disabled
  // with an in-progress label, not silently unresponsive.
  await expect(submitBtn).toBeDisabled({ timeout: 200 });
  await expect(submitBtn).toHaveText(/creating/i);

  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
});

test("exactly one network submission occurs for one click, and rapid repeated clicks never create more than one", async ({ page }) => {
  const mock = await mockMarketingStudioShop(page);
  const root = await openMarketingStudioShop(page);

  await root.locator('textarea[name="brief"]').fill("A cute post about buying yourself flowers.");
  // Real native DOM .click() calls fired back to back in the same tick —
  // the closest realistic simulation of an impatient user clicking several
  // times before anything visibly happens. A disabled submit button does
  // not dispatch further click events at all (browser-native behavior),
  // which is exactly the guarantee this proves: the second and third calls
  // here must be no-ops, not two additional real submissions.
  await root.locator("#msCreateItemForm").evaluate((form) => {
    const btn = form.querySelector('button[type="submit"]');
    btn.click();
    btn.click();
    btn.click();
  });

  await expect(root.locator('[data-ms-item="new-item-1"]')).toBeVisible({ timeout: 5000 });
  expect(mock.counts().createContentItemCalls).toBe(1);
});

test("a background refresh triggered by an existing item's own action never removes or replaces the create-item form's DOM node", async ({ page }) => {
  const existingItem = { id: "existing-1", content_type: "image_post", title: "Spring specials", brief: "Post about spring specials.", status: "idea" };
  await mockMarketingStudioShop(page, { items: [existingItem], listContentDelayAfterFirstCall: NETWORK_DELAY_MS });
  const root = await openMarketingStudioShop(page);

  // Mark the CURRENT create-form DOM node so a later query can tell
  // whether it's still the same node (a rebuilt node, from fresh HTML,
  // would never carry this attribute — it isn't part of createFormHtml()'s
  // template).
  await root.locator("#msCreateItemForm").evaluate((form) => form.setAttribute("data-test-stable", "yes"));

  await root.locator('[data-ms-item="existing-1"] [data-ms-act="generate"]').click();

  // While the action's own background refresh (list_content et al.,
  // artificially delayed) is in flight, the exact same marked node must
  // still be present, and the item's own busy state (shown on its action
  // button, not the eyebrow) confirms the refresh really is in progress.
  await expect(root.locator('#msCreateItemForm[data-test-stable="yes"]')).toBeVisible();
  await expect(root.locator('[data-ms-item="existing-1"] [data-ms-act="generate"]')).toHaveText(/working/i);

  // And still true once the refresh has fully settled.
  await expect(root.locator('[data-ms-item="existing-1"] .eyebrow')).toHaveText(/ready for your review/i, { timeout: 5000 });
  await expect(root.locator('#msCreateItemForm[data-test-stable="yes"]')).toBeVisible();
});

test("after a successful submission the UI transitions to the generating/draft state normally", async ({ page }) => {
  await mockMarketingStudioShop(page);
  const root = await openMarketingStudioShop(page);

  await root.locator('textarea[name="brief"]').fill("A cute post about buying yourself flowers.");
  await root.locator('#msCreateItemForm button[type="submit"]').click();

  await expect(page.locator("#toast")).toHaveText(/ready for your review/i, { timeout: 5000 });
  await expect(root.locator('[data-ms-item="new-item-1"] .eyebrow')).toHaveText(/ready for your review/i);
  // The form is reset and ready for the next post — never left disabled.
  await expect(root.locator('#msCreateItemForm button[type="submit"]')).toBeEnabled();
  await expect(root.locator('#msCreateItemForm button[type="submit"]')).toHaveText(/create draft/i);
});

test("a background refresh's own failure surfaces as a toast and never destroys the already-rendered create form", async ({ page }) => {
  const existingItem = { id: "existing-1", content_type: "image_post", title: "Spring specials", brief: "Post about spring specials.", status: "draft" };
  await mockMarketingStudioShop(page, { items: [existingItem], failListContentAfterFirstCall: true });
  const root = await openMarketingStudioShop(page);

  await root.locator("#msCreateItemForm").evaluate((form) => form.setAttribute("data-test-stable", "yes"));

  // Any action that triggers load() again exercises the now-failing
  // list_content call — "reject" is a simple one that needs no confirm
  // dialog handling beyond the browser's native confirm(), accepted below.
  page.once("dialog", (dialog) => dialog.accept());
  await root.locator('[data-ms-item="existing-1"] [data-ms-act="reject"]').click();

  await expect(page.locator("#toast")).toHaveText(/could not load marketing studio|error/i, { timeout: 5000 });
  // The create form (same DOM node) and the existing item card must both
  // still be there — a background refresh failure must never replace the
  // whole page with a bare error panel the way the very first load's own
  // failure legitimately does.
  await expect(root.locator('#msCreateItemForm[data-test-stable="yes"]')).toBeVisible();
  await expect(root.locator('[data-ms-item="existing-1"]')).toBeVisible();
});
