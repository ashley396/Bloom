import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Launch-blocker pass, Blocker 4 — the Content Calendar / Review / Approve
 * / Schedule UI added to public/marketing-studio-admin.js
 * (#marketingStudioRoot inside admin.html). Every state this exercises is
 * driven by scripted marketing-studio.js responses, matching what the
 * real backend actions (list_content/approve_content/schedule_content_item/
 * enqueue_publish) actually return — nothing here asserts a fake "it
 * worked" beyond what the mocked response says.
 */

const DRAFT_ITEM = {
  id: "item-1",
  content_type: "image_post",
  title: "Fall Bouquet Launch",
  brief: "Announce the new fall arrangement line.",
  status: "draft",
  uses_ai_clone: false,
  requires_human_approval: true,
  updated_at: "2026-09-01T12:00:00.000Z",
  variants: [
    {
      id: "variant-1",
      content_item_id: "item-1",
      platform: "facebook",
      status: "pending",
      scheduled_at: null,
      caption: "Introducing our fall collection!",
      ai_disclosure_required: true,
      disclosure_applied: false
    }
  ]
};

async function mockMarketingStudio(page, { items = [DRAFT_ITEM], onAction } = {}) {
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
        body: JSON.stringify({
          clone_provider: { live: false },
          note: "NOT LIVE — PROVIDER CONNECTION REQUIRED.",
          supported_platforms: [{ platform: "facebook", live: false }]
        })
      });
      return;
    }
    if (action === "list_content" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
      return;
    }
    if (action === "list_clone_consent" || action === "list_personal_brand_reference_photos" || action === "get_personal_brand_profile" || action === "usage_summary") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], profile: {}, estimated_total_cents: 0, actual_total_cents: 0 }) });
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

test.describe("Marketing Studio Content Calendar", () => {
  test("renders the calendar with a real status badge, and opens a content item's detail view", async ({ page }) => {
    await mockMarketingStudio(page);
    const root = await openMarketingStudio(page);

    await expect(root.locator("#msContentList")).toContainText("Fall Bouquet Launch");
    await expect(root.locator("#msContentList")).toContainText("Draft");

    await root.locator('[data-content-item="item-1"]').click();
    const detail = root.locator("#msContentDetail");
    await expect(detail).toContainText("Fall Bouquet Launch");
    await expect(detail).toContainText("Introducing our fall collection!");
    // Disclosure required but not applied must show a real warning, never silently pass.
    await expect(detail).toContainText("Disclosure REQUIRED");
    // Draft status: approve/reject visible, queue-for-publishing NOT (not approved yet).
    await expect(detail.locator("#msApproveBtn")).toBeVisible();
    await expect(detail.locator("#msRejectBtn")).toBeVisible();
    await expect(detail.locator("#msQueueBtn")).toHaveCount(0);
    // Honest disconnected-provider status, never a fake green "connected".
    await expect(detail).toContainText("Connection required");
  });

  test("approving a draft item calls approve_content and the item's status updates", async ({ page }) => {
    let approveCalled = false;
    const approvedItem = { ...DRAFT_ITEM, status: "approved" };
    await mockMarketingStudio(page, {
      items: [DRAFT_ITEM],
      onAction: async (route, action, body) => {
        if (action === "approve_content") {
          approveCalled = true;
          expect(body.decision).toBe("approved");
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "approved" } }) });
          return true;
        }
        if (action === "list_content" && approveCalled) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [approvedItem] }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await root.locator("#msApproveBtn").click();
    expect(approveCalled).toBe(true);
    // After approval, the re-rendered detail should now offer queueing —
    // generation never equals approval, but approval unlocks scheduling/queueing.
    await expect(root.locator("#msContentDetail")).toContainText("Approved");
    await expect(root.locator("#msContentDetail #msQueueBtn")).toBeVisible();
  });

  test("rejecting a draft item calls approve_content with decision='rejected' after confirmation", async ({ page }) => {
    let rejectCalled = false;
    await mockMarketingStudio(page, {
      items: [DRAFT_ITEM],
      onAction: async (route, action, body) => {
        if (action === "approve_content") {
          rejectCalled = true;
          expect(body.decision).toBe("rejected");
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: "item-1", status: "archived" } }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    page.once("dialog", (dialog) => dialog.accept());
    await root.locator('[data-content-item="item-1"]').click();
    await root.locator("#msRejectBtn").click();
    await page.waitForTimeout(100);
    expect(rejectCalled).toBe(true);
  });

  test("scheduling converts a local date/time via schedule_content_item and shows the shop's timezone in the confirmation", async ({ page }) => {
    let scheduleBody = null;
    await mockMarketingStudio(page, {
      items: [{ ...DRAFT_ITEM, status: "approved" }],
      onAction: async (route, action, body) => {
        if (action === "schedule_content_item") {
          scheduleBody = body;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ scheduled_at_utc: "2026-11-01T16:00:00.000Z", timezone: "America/Los_Angeles" })
          });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await root.locator("#msScheduleInput").fill("2026-11-01T08:00");
    await root.locator("#msScheduleBtn").click();
    await expect(root.locator("#msScheduleStatus")).toContainText("America/Los_Angeles");
    expect(scheduleBody.scheduled_at_local).toBe("2026-11-01T08:00");
  });

  test("queueing an approved item calls enqueue_publish and reports jobs queued, without claiming anything actually published", async ({ page }) => {
    let enqueueCalled = false;
    await mockMarketingStudio(page, {
      items: [{ ...DRAFT_ITEM, status: "approved" }],
      onAction: async (route, action) => {
        if (action === "enqueue_publish") {
          enqueueCalled = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs_queued: 1 }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await root.locator('[data-content-item="item-1"]').click();
    await root.locator("#msQueueBtn").click();
    expect(enqueueCalled).toBe(true);
    await expect(root.locator("#msQueueStatus")).toContainText("Queued 1 job");
    await expect(root.locator("#msQueueStatus")).not.toContainText("published");
  });

  test("an empty calendar shows a real empty state, not a blank/broken panel", async ({ page }) => {
    await mockMarketingStudio(page, { items: [] });
    const root = await openMarketingStudio(page);
    await expect(root.locator("#msContentList")).toContainText("Plan this month");
  });
});
