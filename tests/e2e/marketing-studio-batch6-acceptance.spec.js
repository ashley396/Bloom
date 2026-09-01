import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
 * J — the one consolidated Marketing Studio (florist-facing shop page)
 * browser suite Part J's own checklist asks for, driving the real
 * marketing-studio-shop-ui.js client against MOCKED provider/backend
 * responses only (no live/paid provider call, ever, in this file).
 *
 * Most of these behaviors already have deep, independently-earned browser
 * coverage elsewhere in this directory:
 *   - render flyer / readiness message timing / regenerate image / retry:
 *     marketing-studio-shop-flyer.spec.js
 *   - revise copy / undo (revert_content_revision):
 *     marketing-studio-shop-revision.spec.js
 *   - approve / reject (admin console surface):
 *     marketing-studio-content-calendar.spec.js
 * This file does not duplicate those — it exists to (1) prove the FULL
 * florist-facing lifecycle is wired together end to end in one story
 * (create → generate → revise → undo → approve, and separately reject),
 * and (2) cover the two items on Part J's list that had no dedicated
 * browser test anywhere yet: duplicate-submission prevention on the
 * create form, and a missing-asset approval failing closed.
 */

const TEXT_ITEM = {
  id: "item-1",
  content_type: "social_post",
  title: "Fall bouquet launch",
  brief: "Announce the new fall arrangement line.",
  status: "draft",
  asset: { id: "asset-1", asset_type: "social_copy", content: { body: "Introducing our new fall arrangements!" }, parent_asset_id: null },
  variants: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook", caption: "Introducing our new fall arrangements!", asset_id: "asset-1" }]
};

async function openMarketingStudioShop(page) {
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingStudioPage"]').click();
  return page.locator("#marketingStudioRoot");
}

function baseRoutes(page, { items, onAction } = {}) {
  return page.route("**/.netlify/functions/marketing-studio-shop**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const method = route.request().method();
    const body = route.request().postDataJSON?.() || {};
    if (onAction) {
      const handled = await onAction(route, action, method, body);
      if (handled) return;
    }
    if (action === "status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marketing_studio_enabled: true, note: "" }) });
      return;
    }
    if (action === "list_content") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: typeof items === "function" ? items() : items }) });
      return;
    }
    if (["get_brand_brain", "get_visual_style", "usage_summary", "connections"].includes(action)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

// 1) create request -> 2) generate draft -> 3) revise copy -> 4) undo ->
// 5) approve, all in one real user story, against the real client.
test("end to end: create request, generate draft, revise copy, undo, and approve all reach the real backend actions with the florist's real content", async ({ page }) => {
  let phase = "empty";
  const calls = { create: null, generate: null, revise: null, revert: null, approve: null };
  await mockBackend(page);
  await baseRoutes(page, {
    items: () => (phase === "empty" ? [] : [phase === "revised" ? { ...TEXT_ITEM, asset: { ...TEXT_ITEM.asset, id: "asset-2", parent_asset_id: "asset-1" } } : TEXT_ITEM]),
    onAction: async (route, action, method, body) => {
      if (action === "create_content_item" && method === "POST") {
        calls.create = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "idea" } }) });
        phase = "created";
        return true;
      }
      if (action === "generate_content" && method === "POST") {
        calls.generate = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: TEXT_ITEM.asset, copy: TEXT_ITEM.asset.content }) });
        phase = "generated";
        return true;
      }
      if (action === "revise_content" && method === "POST") {
        calls.revise = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: { id: "asset-2", type: "social_copy" } }) });
        phase = "revised";
        return true;
      }
      if (action === "revert_content_revision" && method === "POST") {
        calls.revert = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: TEXT_ITEM.asset }) });
        phase = "generated";
        return true;
      }
      if (action === "approve_content" && method === "POST") {
        calls.approve = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "approved" } }) });
        phase = "approved";
        return true;
      }
      return false;
    }
  });

  const root = await openMarketingStudioShop(page);
  await expect(root.locator("#msCreateItemForm")).toBeVisible();

  // 1) Create request.
  await root.locator('#msCreateItemForm textarea[name="brief"]').fill(TEXT_ITEM.brief);
  await root.locator('#msCreateItemForm button[type="submit"]').click();

  // 2) Generate draft — chained automatically off the one create request,
  // per the real client's own documented "one message in, one finished
  // draft out" contract.
  await expect.poll(() => calls.generate).not.toBeNull();
  expect(calls.create.brief).toBe(TEXT_ITEM.brief);
  expect(calls.generate.content_item_id).toBe("item-1");
  const card = root.locator('[data-ms-item="item-1"]');
  await expect(card).toBeVisible({ timeout: 10_000 });

  // 3) Revise copy.
  await card.locator('[data-ms-act="revise"]').click();
  await root.locator("#msRevisionInput-item-1").fill("Make it a bit shorter");
  await root.locator('[data-ms-act="revise-send"]').click();
  await expect.poll(() => calls.revise).not.toBeNull();
  expect(calls.revise.content_item_id).toBe("item-1");
  expect(calls.revise.instruction).toBe("Make it a bit shorter");

  // 4) Undo — only offered once a revision exists (parent_asset_id set).
  await expect(card.locator('[data-ms-act="revert"]')).toBeVisible({ timeout: 5000 });
  page.on("dialog", (d) => d.accept());
  await card.locator('[data-ms-act="revert"]').click();
  await expect.poll(() => calls.revert).not.toBeNull();
  expect(calls.revert.content_item_id).toBe("item-1");

  // 5) Approve.
  await expect(card.locator('[data-ms-act="approve"]')).toBeEnabled({ timeout: 5000 });
  await card.locator('[data-ms-act="approve"]').click();
  await expect.poll(() => calls.approve).not.toBeNull();
  expect(calls.approve.content_item_id).toBe("item-1");
  expect(calls.approve.decision).toBe("approved");
});

// Reject, exercised as its own real, separate florist decision.
test("reject sends decision:'rejected' through the real approve_content action after confirmation", async ({ page }) => {
  let approveCall = null;
  await mockBackend(page);
  await baseRoutes(page, {
    items: [TEXT_ITEM],
    onAction: async (route, action, method, body) => {
      if (action === "approve_content" && method === "POST") {
        approveCall = body;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "rejected" } }) });
        return true;
      }
      return false;
    }
  });
  const root = await openMarketingStudioShop(page);
  const card = root.locator('[data-ms-item="item-1"]');
  await expect(card).toBeVisible();

  page.on("dialog", (d) => d.accept());
  await card.locator('[data-ms-act="reject"]').click();

  await expect.poll(() => approveCall).not.toBeNull();
  expect(approveCall.content_item_id).toBe("item-1");
  expect(approveCall.decision).toBe("rejected");
});

// Part J / Part P #27: atomic duplicate-submission protection, exercised
// at the real browser/client level (marketing-studio-shop-ui.js's own
// `form.dataset.submitting` guard plus disabling the submit button) — a
// distinct layer from Batch 3's server-side atomic claim, both real.
test("duplicate-submission prevention: rapid double-submission of the create form sends exactly one create_content_item call", async ({ page }) => {
  let createCallCount = 0;
  let resolveFirst;
  const firstCallStarted = new Promise((r) => { resolveFirst = r; });
  await mockBackend(page);
  await baseRoutes(page, {
    items: [],
    onAction: async (route, action, method) => {
      if (action === "create_content_item" && method === "POST") {
        createCallCount += 1;
        resolveFirst();
        // Held deliberately, so a second, un-guarded click would have a
        // real window to fire its own request before the first settles.
        await new Promise((r) => setTimeout(r, 500));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "idea" } }) });
        return true;
      }
      if (action === "generate_content" && method === "POST") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "draft" }, asset: TEXT_ITEM.asset, copy: TEXT_ITEM.asset.content }) });
        return true;
      }
      return false;
    }
  });
  const root = await openMarketingStudioShop(page);
  const form = root.locator("#msCreateItemForm");
  await form.locator('textarea[name="brief"]').fill(TEXT_ITEM.brief);

  const submitBtn = form.locator('button[type="submit"]');
  // Two rapid clicks — not sequential awaited clicks (which a slow test
  // runner could space out enough to make the guard irrelevant), but two
  // dispatched together so both land while the first request is in flight.
  await Promise.all([submitBtn.click(), submitBtn.click({ force: true })]);
  await firstCallStarted;
  await page.waitForTimeout(700);

  expect(createCallCount, "exactly one create_content_item call must reach the backend from a rapid double-submit").toBe(1);
});

// Part J / Part P #34: missing-asset approval failure. A content item can
// legitimately reach status:'draft' with no generated asset at all yet
// (e.g. the chained generate_content call failed and the florist is
// looking at the raw "Ask Lily to create it" state promoted back to
// draft by a retry) — the real server-side fail-closed gate
// (contentApprovalBlockReason / marketing-studio.js's approve_content,
// shared verbatim by marketing-studio-shop.js's dispatch) is what
// actually refuses this, not client-side guesswork; this proves the
// browser surfaces that refusal honestly rather than showing a false
// "approved" state.
test("missing-asset approval fails closed: approving an item with no real generated asset is refused by the real backend action and the UI never shows a false success", async ({ page }) => {
  const NO_ASSET_ITEM = { ...TEXT_ITEM, asset: null, variants: [] };
  let approveAttempted = false;
  await mockBackend(page);
  await baseRoutes(page, {
    items: [NO_ASSET_ITEM],
    onAction: async (route, action, method) => {
      if (action === "approve_content" && method === "POST") {
        approveAttempted = true;
        // The real, shared handler's actual fail-closed shape for this
        // case (Batch 3, Part D/F) — a 409 with an explanatory message,
        // never a silent 200.
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This post's current content couldn't be found — it may have been deleted. Try regenerating it." }) });
        return true;
      }
      return false;
    }
  });
  const root = await openMarketingStudioShop(page);
  const card = root.locator('[data-ms-item="item-1"]');
  await expect(card).toBeVisible();

  page.on("dialog", (d) => d.accept());
  await card.locator('[data-ms-act="approve"]').click();

  await expect.poll(() => approveAttempted).toBe(true);
  // The item must never read as approved off a failed call — reloading
  // the mocked list keeps returning the same draft item, and the client's
  // own error toast (the real #toast element app.js's global toast()
  // writes to) is the only honest outcome here, not a swallowed failure.
  await expect(page.locator("#toast")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#toast")).toHaveText(/couldn't be found|deleted|regenerating/i);
  await expect(card).toBeVisible();
});
