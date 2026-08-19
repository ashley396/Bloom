import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * WBX/Marketing Step 82: real bugs found and fixed while stabilizing the
 * three existing, disconnected Marketing modules (Email Campaigns, Holiday
 * Command Center, Wedding Workflows) before building the unified Campaign
 * layer on top of them.
 */

test.describe("Email Campaigns: 'Mark sent' confirm tells the truth about what it does", () => {
  async function openWithRealSend(page, realSend) {
    await mockBackend(page);
    await withFakeSession(page);
    await page.route("**/.netlify/functions/email-campaigns", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [{ id: "camp-1", name: "Spring launch", subject: "Fresh for spring", status: "draft" }],
            send_enabled: true,
            real_send: realSend,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="emailCampaignsPage"]').click();
    await expect(page.locator('[data-campaign-id="camp-1"]')).toBeVisible();
  }

  test("a real email provider is configured: the dialog says this really sends to real customers", async ({ page }) => {
    await openWithRealSend(page, true);

    let message = "";
    page.on("dialog", async (dialog) => {
      message = dialog.message();
      await dialog.dismiss();
    });

    await page.locator('[data-campaign-id="camp-1"] [data-campaign-act="send"]').click();
    await expect.poll(() => message).not.toBe("");
    expect(message.toLowerCase()).not.toContain("local stub");
    expect(message.toLowerCase()).toContain("real");
  });

  test("no provider configured: the dialog is honest that nothing actually sends", async ({ page }) => {
    await openWithRealSend(page, false);

    let message = "";
    page.on("dialog", async (dialog) => {
      message = dialog.message();
      await dialog.dismiss();
    });

    await page.locator('[data-campaign-id="camp-1"] [data-campaign-act="send"]').click();
    await expect.poll(() => message).not.toBe("");
    expect(message.toLowerCase()).toContain("local stub");
    expect(message.toLowerCase()).toContain("nothing is actually sent");
  });
});

test.describe("Holiday Command Center: pausing/resuming order intake preserves the peak's real status", () => {
  test("a peak still in 'planning' comes back to 'planning' after pause then resume, not 'active'", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);

    const item = {
      id: "peak-1",
      name: "Mother's Day",
      status: "planning",
      is_paused: false,
      starts_on: "2027-05-01",
      ends_on: "2027-05-09",
      target_orders: 50,
      current_orders: 5,
      alert_threshold: 80,
      capacity: { level: "ok", pct: 10, message: "10% of capacity target." },
    };

    await page.route("**/.netlify/functions/holiday-command", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [item] }) });
      }
      if (req.method() === "PATCH") {
        const body = JSON.parse(req.postData() || "{}");
        // Real production behavior: is_paused is independent of status.
        if (body.is_paused !== undefined) item.is_paused = body.is_paused;
        if (body.status !== undefined) item.status = body.status;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="holidayPage"]').click();

    const card = page.locator('[data-holiday-id="peak-1"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-holiday-act="pause"]')).toHaveText("Pause orders");

    await card.locator('[data-holiday-act="pause"]').click();
    await expect(card.locator('[data-holiday-act="pause"]')).toHaveText("Resume orders");
    // Still shown as planning while paused — pausing never promotes it.
    await expect(card.locator(".eyebrow")).toHaveText("PLANNING");

    await card.locator('[data-holiday-act="pause"]').click();
    await expect(card.locator('[data-holiday-act="pause"]')).toHaveText("Pause orders");
    // The real bug: resuming used to hardcode status:"active" here.
    await expect(card.locator(".eyebrow")).toHaveText("PLANNING");
  });
});
