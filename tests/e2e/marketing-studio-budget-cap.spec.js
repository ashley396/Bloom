import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Priority 2 of the "finish everything that can safely be completed
 * without Ashley" pass — persisted per-shop Marketing Studio monthly
 * budget controls. Every state here is driven by scripted
 * marketing-studio.js responses matching what the real backend actions
 * (usage_summary's new fields, set_marketing_budget_cap) actually return.
 */

async function mockMarketingStudio(page, { usageSummary, onAction } = {}) {
  await mockAdminBackend(page);
  await page.route("**/.netlify/functions/marketing-studio**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const body = route.request().postDataJSON?.() || {};
    if (onAction) {
      const handled = await onAction(route, action, body);
      if (handled) return;
    }
    if (action === "status" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ clone_provider: { live: false }, note: "NOT LIVE.", supported_platforms: [{ platform: "facebook", live: false }] })
      });
      return;
    }
    if (action === "list_content" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    if (action === "usage_summary" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          estimated_total_cents: 0,
          actual_total_cents: 0,
          monthly_budget_cap_cents: null,
          monthly_committed_spend_cents: null,
          monthly_remaining_cents: null,
          ...usageSummary
        })
      });
      return;
    }
    if (action === "list_clone_consent" || action === "list_personal_brand_reference_photos" || action === "get_personal_brand_profile") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], profile: {} }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openMarketingStudio(page) {
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
  await page.locator('aside nav button[data-view="marketingStudio"]').click();
  const root = page.locator("#marketingStudioRoot");
  await root.locator("#msShopId").fill("shop-1");
  await root.locator("#msLoadShop").click();
  return root;
}

test.describe("Marketing Studio budget cap control", () => {
  test("a shop's real configured cap and remaining budget populate from usage_summary — nothing fabricated client-side", async ({ page }) => {
    await mockMarketingStudio(page, {
      usageSummary: { monthly_budget_cap_cents: 10000, monthly_committed_spend_cents: 4000, monthly_remaining_cents: 6000 }
    });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msBudgetCapInput")).toHaveValue("100.00");
    await expect(root.locator("#msBudgetRemaining")).toContainText("$40.00 committed of a $100.00 cap — $60.00 remaining.");
  });

  test("an unconfigured shop shows an empty cap input and an honest 'unlimited' message, never a guessed cap", async ({ page }) => {
    await mockMarketingStudio(page, { usageSummary: { monthly_budget_cap_cents: null, monthly_committed_spend_cents: null, monthly_remaining_cents: null } });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msBudgetCapInput")).toHaveValue("");
    await expect(root.locator("#msBudgetRemaining")).toContainText("No monthly budget cap configured for this shop — generation spend is unlimited.");
  });

  test("saving a dollar amount calls set_marketing_budget_cap with the correct cents conversion and confirms it saved", async ({ page }) => {
    let savedBody = null;
    await mockMarketingStudio(page, {
      onAction: async (route, action, body) => {
        if (action === "set_marketing_budget_cap") {
          savedBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ monthly_budget_cap_cents: body.monthly_budget_cents }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator("#msBudgetCapInput").fill("75.50");
    await root.locator("#msSaveBudgetCapBtn").click();

    expect(savedBody.shop_id).toBe("shop-1");
    expect(savedBody.monthly_budget_cents).toBe(7550);
    await expect(root.locator("#msBudgetCapStatus")).toContainText("Saved.");
  });

  test("clearing the input and saving sends null — clearing the cap back to unlimited, not zero", async ({ page }) => {
    let savedBody = null;
    await mockMarketingStudio(page, {
      usageSummary: { monthly_budget_cap_cents: 10000, monthly_committed_spend_cents: 0, monthly_remaining_cents: 10000 },
      onAction: async (route, action, body) => {
        if (action === "set_marketing_budget_cap") {
          savedBody = body;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ monthly_budget_cap_cents: null }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msBudgetCapInput")).toHaveValue("100.00");
    await root.locator("#msBudgetCapInput").fill("");
    await root.locator("#msSaveBudgetCapBtn").click();

    expect(savedBody.shop_id).toBe("shop-1");
    expect(savedBody.monthly_budget_cents).toBe(null);
    await expect(root.locator("#msBudgetCapStatus")).toContainText("Saved.");
  });

  test("a negative amount is rejected client-side without ever calling the backend", async ({ page }) => {
    let called = false;
    await mockMarketingStudio(page, {
      onAction: async (route, action) => {
        if (action === "set_marketing_budget_cap") called = true;
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator("#msBudgetCapInput").fill("-5");
    await root.locator("#msSaveBudgetCapBtn").click();
    await expect(root.locator("#msBudgetCapStatus")).toContainText("non-negative");
    expect(called).toBe(false);
  });
});
