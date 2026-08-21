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
    // Marketing navigation cleanup: Email Campaigns no longer has its own
    // standalone sidebar entry (Marketing is the one central marketing
    // workspace) — reach it the same way a florist now does, through
    // Marketing's own Overview tab link-out.
    await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
    await page.locator('[data-marketing-goto="emailCampaignsPage"]').click();
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

test.describe("Holiday Command Center: double-clicking 'Add peak' does not create a duplicate holiday", () => {
  test("a slow-connection double-click on Add peak sends exactly one POST — the real cause of 'duplicate holiday cards'", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);

    let postCount = 0;
    const items = [];
    await page.route("**/.netlify/functions/holiday-command", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
      }
      if (req.method() === "POST") {
        postCount += 1;
        // Simulate a slow connection — this is the window a real double-click
        // used to race through and fire the handler twice.
        await new Promise((r) => setTimeout(r, 400));
        const body = JSON.parse(req.postData() || "{}");
        items.push({ id: `peak-${postCount}`, ...body, capacity: { level: "ok", pct: 0, message: "" } });
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ item: items[items.length - 1] }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="holidayPage"]').click();
    await page.locator("#holidayShowFormBtn").click();

    await page.fill('#holidayPeakForm [name="name"]', "Valentine's Day");
    await page.fill('#holidayPeakForm [name="starts_on"]', "2027-02-01");
    await page.fill('#holidayPeakForm [name="ends_on"]', "2027-02-14");

    // Two real, back-to-back submit events dispatched before either has a
    // chance to yield to the network — exactly what a fast real-world
    // double-click produces, and exactly what form.dataset.submitting is
    // meant to guard against.
    await page.evaluate(() => {
      const form = document.getElementById("holidayPeakForm");
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.locator('[data-holiday-id^="peak-"]')).toHaveCount(1, { timeout: 5_000 });
    expect(postCount).toBe(1);
  });
});
