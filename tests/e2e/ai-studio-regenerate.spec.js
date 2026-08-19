import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * "Regenerate" on Lily AI Studio replies — lets a florist ask for a
 * different answer instead of retyping the same prompt. Verifies the
 * button appears only on the latest assistant reply, calling it replaces
 * that reply's text in place (not a duplicate new message), and an older
 * reply's button is removed once a newer one arrives.
 */
test("regenerating a Lily reply swaps in a new answer without retyping the prompt", async ({ page }) => {
  // The dashboard also fires its own unrelated ai-assistant call on load (Rose's
  // morning briefing, mode:"chat") — only count/respond to the AI Studio's
  // mode:"generate" requests so that background traffic doesn't skew the count.
  let generateCallCount = 0;
  const replies = ["First draft — a little formal.", "Second draft — warmer and more playful!"];

  await mockBackend(page);
  await page.route("**/.netlify/functions/ai-assistant**", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.mode !== "generate") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    generateCallCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { message: replies[Math.min(generateCallCount, 2) - 1] } }),
    });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="aiStudioPage"]').click();

  await page.locator("#aiStudioPrompt").fill("Write a warm homepage tagline.");
  await page.locator("#aiStudioForm button[type=submit]").click();

  const messages = page.locator("#aiStudioMessages .ai-message.assistant");
  await expect(messages).toHaveCount(2); // greeting + first reply
  const firstReply = messages.last();
  await expect(firstReply.locator("p")).toHaveText("First draft — a little formal.");

  const regenBtn = firstReply.locator(".ai-regenerate");
  await expect(regenBtn).toBeVisible();
  await regenBtn.click();

  // Same bubble, new text — not a new message appended.
  await expect(messages).toHaveCount(2);
  await expect(firstReply.locator("p")).toHaveText("Second draft — warmer and more playful!");
  expect(generateCallCount).toBe(2);

  // Regenerate never re-appended the user's prompt as a new message.
  await expect(page.locator("#aiStudioMessages .ai-message.user")).toHaveCount(1);

  // Asking a brand-new question removes the regenerate button from the old
  // reply — only the newest assistant message keeps one.
  await page.route("**/.netlify/functions/ai-assistant**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { message: "A brand new answer." } }),
    }),
  );
  await page.locator("#aiStudioPrompt").fill("Now write a product description.");
  await page.locator("#aiStudioForm button[type=submit]").click();

  await expect(page.locator("#aiStudioMessages .ai-message.assistant")).toHaveCount(3);
  await expect(page.locator("#aiStudioMessages .ai-regenerate")).toHaveCount(1);
  await expect(page.locator("#aiStudioMessages .ai-message.assistant").last().locator(".ai-regenerate")).toBeVisible();
});
