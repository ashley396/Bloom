import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Marketing Step 83: the new Marketing hub — the connective layer over
 * Email Campaigns, Holiday Command Center, and Wedding Workflows, which
 * previously had no shared entry point at all ("/marketing" opened Email
 * Campaigns directly). Exercises the real UI: create a campaign, see it
 * reflected in the Overview counts, advance its status, and jump out to
 * one of the connected tools.
 */

function buildState() {
  return { items: [] };
}

async function routeMarketing(page, state) {
  await page.route("**/.netlify/functions/marketing-campaigns", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: state.items }) });
    }
    const body = JSON.parse(req.postData() || "{}");
    if (body.action === "create") {
      const item = {
        id: `camp-${state.items.length + 1}`,
        name: body.name,
        goal: body.goal || null,
        status: "draft",
        starts_on: body.starts_on || null,
        ends_on: body.ends_on || null,
        audience_note: body.audience_note || null,
        channels: body.channels || [],
        product_ids: body.product_ids || [],
      };
      state.items.unshift(item);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ item }) });
    }
    if (body.action === "update") {
      const item = state.items.find((c) => c.id === body.id);
      if (item && body.status) item.status = body.status;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item }) });
    }
    if (body.action === "delete") {
      state.items = state.items.filter((c) => c.id !== body.id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test("creating a campaign shows up in Overview counts and can be advanced to Ready", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  const state = buildState();
  await routeMarketing(page, state);

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();

  // Starts on Overview with nothing drafted yet.
  await expect(page.locator("#marketingRoot .marketing-tab.active")).toHaveText("Overview");
  await expect(page.locator("#marketingRoot")).toContainText("No campaigns yet");

  await page.locator('[data-marketing-tab="campaigns"]').click();
  await page.locator('#marketingCampaignForm input[name="name"]').fill("Mother's Day 2027");
  await page.locator('#marketingCampaignForm input[name="goal"]').fill("Sell out Designer's Choice");
  await page.locator('#marketingCampaignForm input[name="audience_note"]').fill("Past Mother's Day buyers");
  await page.locator('#marketingCampaignForm input[name="channels"][value="email"]').check();
  await page.locator("#marketingCampaignForm button[type=submit]").click();

  const card = page.locator('[data-campaign-id="camp-1"]');
  await expect(card).toBeVisible();
  await expect(card.locator(".eyebrow")).toHaveText("DRAFT");

  await page.locator('[data-marketing-tab="overview"]').click();
  await expect(page.locator(".marketing-overview-cards article").nth(2).locator("h2")).toHaveText("1"); // Draft/Ready count

  await page.locator('[data-marketing-tab="campaigns"]').click();
  await card.locator('[data-campaign-act="advance"]').click();
  await expect(card.locator(".eyebrow")).toHaveText("READY");

  expect(consoleErrors).toEqual([]);
});

test("a paused campaign can be resumed back to active", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  const state = { items: [{ id: "camp-1", name: "Spring Flowers", status: "active", channels: [] }] };
  await routeMarketing(page, state);

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="campaigns"]').click();

  const card = page.locator('[data-campaign-id="camp-1"]');
  await card.locator('[data-campaign-act="pause"]').click();
  await expect(card.locator(".eyebrow")).toHaveText("PAUSED");
  await expect(card.locator('[data-campaign-act="resume"]')).toBeVisible();

  await card.locator('[data-campaign-act="resume"]').click();
  await expect(card.locator(".eyebrow")).toHaveText("ACTIVE");
});

test("Audiences tab shows real segment counts and prefills the campaign form from a segment", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  await routeMarketing(page, buildState());

  let audiencesRequested = false;
  await page.route("**/.netlify/functions/marketing-campaigns?action=audiences", (route) => {
    audiencesRequested = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subscriberCount: 12,
        segments: [
          { key: "vip", label: "VIP customers", count: 4 },
          { key: "wedding_customers", label: "Wedding customers", count: 0 },
        ],
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();

  // Not fetched until the tab is actually opened.
  expect(audiencesRequested).toBe(false);

  await page.locator('[data-marketing-tab="audiences"]').click();
  await expect(page.locator('[data-audience-key="vip"] h2')).toHaveText("4");
  expect(audiencesRequested).toBe(true);

  // A segment with zero opted-in customers can't be used for a campaign.
  await expect(page.locator('[data-audience-use="wedding_customers"]')).toBeDisabled();

  await page.locator('[data-audience-use="vip"]').click();
  await expect(page.locator("#marketingRoot .marketing-tab.active")).toHaveText("Campaigns");
  await expect(page.locator('#marketingCampaignForm input[name="audience_note"]')).toHaveValue("VIP customers (4)");

  expect(consoleErrors).toEqual([]);
});

test("Lily drafts a campaign from real shop data and only fills the form — never auto-creates it", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  const state = buildState();
  await routeMarketing(page, state);

  let capturedInput = null;
  await page.route("**/.netlify/functions/ai-assistant**", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.mode !== "generate") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    capturedInput = body.input;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          message: "Your roses are the star for Mother's Day this year.",
          name: "Mother's Day 2027",
          goal: "Sell out the Rose Garden Bouquet",
          audience_note: "VIP customers (4)",
          channels: ["email", "social"],
        },
      }),
    });
  });

  page.on("dialog", (dialog) => dialog.accept("Mother's Day"));

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="campaigns"]').click();

  await page.locator("#marketingAskLily").click();
  await expect(page.locator("#marketingApplyLily")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#marketingRoot")).toContainText("Mother's Day 2027");

  // Never a raw customer record in what Lily was actually sent.
  expect(capturedInput).not.toBeNull();
  expect(JSON.stringify(capturedInput)).not.toMatch(/@|\d{3}-\d{4}/); // no email, no phone-shaped strings

  // Nothing created yet — only after Apply, then the florist's own submit.
  expect(state.items).toHaveLength(0);

  await page.locator("#marketingApplyLily").click();
  await expect(page.locator('#marketingCampaignForm input[name="name"]')).toHaveValue("Mother's Day 2027");
  await expect(page.locator('#marketingCampaignForm input[name="audience_note"]')).toHaveValue("VIP customers (4)");
  await expect(page.locator('#marketingCampaignForm input[name="channels"][value="email"]')).toBeChecked();
  await expect(page.locator('#marketingCampaignForm input[name="channels"][value="text"]')).not.toBeChecked();

  // Still nothing created until the florist explicitly submits.
  expect(state.items).toHaveLength(0);
  await page.locator("#marketingCampaignForm button[type=submit]").click();
  await expect(page.locator('[data-campaign-id="camp-1"]')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("a campaign can carry real products, and 'Prepare website'/'Create campaign image' hand off to those real tools", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  const state = buildState();
  await routeMarketing(page, state);
  await page.route("**/.netlify/functions/products", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { id: "prod-1", name: "Rose Garden Bouquet", category: "Everyday", price: 65 },
          { id: "prod-2", name: "Sympathy Standing Spray", category: "Sympathy", price: 150 },
        ],
      }),
    }),
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  // Visit Products first — real app behavior: the global product list is
  // populated by loadProducts(), same as Marketing's own form relies on.
  await page.locator('nav.florisyn-lux-nav button[data-page="productsPage"]').click();
  await expect(page.locator("#productsList")).toContainText("Rose Garden Bouquet");

  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="campaigns"]').click();

  await page.locator('#marketingCampaignForm input[name="name"]').fill("Mother's Day 2027");
  await page.locator('#marketingCampaignForm input[name="product_ids"][value="prod-1"]').check();
  await page.locator("#marketingCampaignForm button[type=submit]").click();

  const card = page.locator('[data-campaign-id="camp-1"]');
  await expect(card).toContainText("Products: Rose Garden Bouquet");
  await expect(card).not.toContainText("Sympathy Standing Spray");

  await page.locator('[data-campaign-act="prepare-website"]').click();
  await expect(page.locator("#websitePage")).toHaveClass(/active/);

  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-campaign-act="create-image"]').click();
  await expect(page.locator("#bloomshotPage")).toHaveClass(/active/);

  expect(consoleErrors).toEqual([]);
});

test("Overview's channel links jump straight to Email Campaigns", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await routeMarketing(page, buildState());

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await expect(page.locator("#marketingRoot")).toBeVisible();

  await page.locator('[data-marketing-goto="emailCampaignsPage"]').click();
  await expect(page.locator("#emailCampaignsPage")).toHaveClass(/active/);
});
