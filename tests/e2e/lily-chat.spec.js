import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Lily Step 74: live e2e coverage for the chat UI itself (public/lily-platform.js)
 * — until now only persona-switching chrome was covered (bud-persona.spec.js).
 * This covers the actual conversation loop: send → assistant reply, the
 * confirm-before-acting gate for actions that change data, the real Coach
 * tab (fed by lily-ai's action:"coach", the same honest engine behind the
 * dashboard's Needs Attention panel — see lib/assistants/needs-attention.js
 * and netlify/functions/_shared/lily-ai-engine.js), and the persona handoff
 * offer.
 */

async function openLily(page) {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();
}

test("sending a message shows the user bubble immediately, then the real assistant reply", async ({ page }) => {
  let requestBody = null;
  await mockBackend(page);
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "Today you have 2 orders due and 1 delivery still active.",
        permission: { allowed: true },
        conversation_id: "conv-1"
      })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  await page.locator("#lilyInput").fill("What's happening today?");
  await page.locator("#lilySend").click();

  await expect(page.locator(".lily-msg.user").last()).toHaveText("What's happening today?");
  await expect(page.locator(".lily-msg.assistant").last()).toHaveText(
    "Today you have 2 orders due and 1 delivery still active.",
    { timeout: 10_000 }
  );
  expect(requestBody.message).toBe("What's happening today?");
  expect(requestBody.persona).toBe("lily");
  await expect(page.locator("#lilyInput")).toHaveValue("");
});

test("an action that changes data is gated behind Confirm — never runs on the first reply", async ({ page }) => {
  await mockBackend(page);
  let confirmedCalls = 0;
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    const body = route.request().postDataJSON();
    if (body.confirm) {
      confirmedCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ response: "Done — inventory updated.", permission: { allowed: true } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: 'I can add 12 roses to inventory. Confirm below and I will guide Florisyn — I will not change anything without your approval.',
        permission: { allowed: true },
        client_action: { pending: true, requiresConfirmation: true, label: "Add 12 roses to inventory?" }
      })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  await page.locator("#lilyInput").fill("add 12 roses");
  await page.locator("#lilySend").click();

  await expect(page.locator("#lilyConfirm")).toBeVisible();
  await expect(page.locator("#lilyConfirm")).toContainText("Add 12 roses to inventory?");
  // A routine IMPORTANT write shouldn't carry the same warning as a DESTRUCTIVE one.
  await expect(page.locator(".lily-confirm-destructive")).toHaveCount(0);
  expect(confirmedCalls).toBe(0);

  await page.locator("#lilyConfirmYes").click();
  await expect(page.locator("#lilyConfirm")).toBeHidden();
  await expect(page.locator(".lily-msg.assistant").last()).toHaveText("Done — inventory updated.", { timeout: 10_000 });
  expect(confirmedCalls).toBe(1);
});

test("a DESTRUCTIVE-tier action shows a stronger, visibly different warning than a routine confirm (Lily Step 76)", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "This will permanently cancel every open order.",
        permission: { allowed: true },
        client_action: { pending: true, requiresConfirmation: true, tier: "DESTRUCTIVE", label: "Cancel all open orders?" }
      })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  await page.locator("#lilyInput").fill("cancel all my orders");
  await page.locator("#lilySend").click();

  await expect(page.locator("#lilyConfirm")).toContainText("Cancel all open orders?");
  await expect(page.locator(".lily-confirm-destructive")).toContainText("can't be undone");
});

test("Cancel on a pending action dismisses it without ever confirming", async ({ page }) => {
  await mockBackend(page);
  let confirmedCalls = 0;
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    const body = route.request().postDataJSON();
    if (body.confirm) confirmedCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "I can remove 5 roses. Confirm below and I will guide Florisyn.",
        permission: { allowed: true },
        client_action: { pending: true, requiresConfirmation: true, label: "Remove 5 roses from inventory?" }
      })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  await page.locator("#lilyInput").fill("remove 5 roses");
  await page.locator("#lilySend").click();
  await expect(page.locator("#lilyConfirm")).toBeVisible();

  await page.locator("#lilyConfirmNo").click();
  await expect(page.locator("#lilyConfirm")).toBeHidden();
  expect(confirmedCalls).toBe(0);
});

test("Coach tab shows real suggestions fetched when the panel opens, and clicking one sends it as a chat message", async ({ page }) => {
  await mockBackend(page);
  let coachRequested = false;
  let sentMessage = null;
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "coach") {
      coachRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: [
            { id: "reorder", title: "Inventory reorder", detail: "3 items are at or below low-stock levels.", prompt: "Which items should I reorder first?" }
          ]
        })
      });
    }
    sentMessage = body.message;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ response: "Reorder roses and hydrangeas first.", permission: { allowed: true } })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();
  expect(coachRequested).toBe(true);

  await page.locator('[data-lily-tab="coach"]').click();
  const coachButton = page.locator('#lilyBody [data-coach]');
  await expect(coachButton).toContainText("Inventory reorder");
  await expect(coachButton).toContainText("3 items are at or below low-stock levels.");

  await coachButton.click();
  await expect(page.locator(".lily-msg.user").last()).toHaveText("Which items should I reorder first?");
  await expect(page.locator(".lily-msg.assistant").last()).toHaveText("Reorder roses and hydrangeas first.", { timeout: 10_000 });
  expect(sentMessage).toBe("Which items should I reorder first?");
});

test("a handoff offer lets the florist switch personas and resend, or stay put", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/.netlify/functions/lily-ai**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "That's really Rose's area.",
        permission: { allowed: true },
        handoff: { to: "Rose" }
      })
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator("#lilyFab").click();
  await expect(page.locator("#lilyPanel")).toBeVisible();

  await page.locator("#lilyInput").fill("what should I charge for a wedding package?");
  await page.locator("#lilySend").click();

  await expect(page.locator("#lilyConfirm")).toContainText("Bring in Rose", { timeout: 10_000 });
  await page.locator("#lilyHandoffYes").click();

  await expect(page.locator("#lilyHeadName")).toHaveText("Rose");
  await expect(page.locator("#lilyConfirm")).toBeHidden();
});
