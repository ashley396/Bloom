import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Community Step 68 — real Following relationships, real search, and real
 * notifications (netlify/functions/florist-community.js: toggle_follow,
 * action=notifications, mark_notifications_read; feed() now takes q and
 * following params instead of only category).
 */
const PROFILE = { display_name: "Rose", shop_display_name: "Rose & Co", city: "Austin", region: "TX", bio: "" };

function makePost(overrides = {}) {
  return {
    id: "post-1",
    author_user_id: "other-user",
    category: "Design Help",
    caption: "Blush garden compote",
    body: "",
    image_url: null,
    is_mine: false,
    like_count: 0,
    comment_count: 0,
    liked: false,
    author_followed: false,
    author: { user_id: "other-user", display_name: "Jamie", shop_display_name: "Petal & Vine", city: "Dallas" },
    share_permission: "inspiration_only",
    allow_photo_use: false,
    ...overrides,
  };
}

async function openCommunity(page, { requestsRef } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (requestsRef) requestsRef.push({ method: req.method(), url: req.url(), body: req.method() === "POST" ? req.postDataJSON() : null });
    if (req.method() === "GET") {
      const url = new URL(req.url());
      const action = url.searchParams.get("action");
      if (action === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      if (url.searchParams.get("following") === "1") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [] }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [makePost()] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();
}

test("the Following tab loads a real, separately-filtered feed and shows an honest empty state", async ({ page }) => {
  await openCommunity(page);
  await expect(page.locator(".community-post")).toHaveCount(1);

  await page.locator('.community-tab[data-tab="following"]').click();
  await expect(page.locator(".community-tab[data-tab='following']")).toHaveClass(/active/);
  await expect(page.locator(".community-post")).toHaveCount(0);
  await expect(page.locator(".community-empty")).toContainText("You're not following anyone yet");
});

test("clicking Follow toggles the real follow state and updates the button", async ({ page }) => {
  const requests = [];
  await openCommunity(page, { requestsRef: requests });
  await page.unroute("**/.netlify/functions/florist-community**");
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      if (url.searchParams.get("action") === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [makePost()] }) });
    }
    const body = req.postDataJSON();
    if (body?.action === "toggle_follow") {
      requests.push(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ following: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  const followBtn = page.locator('[data-follow-author="other-user"]');
  await expect(followBtn).toHaveText("+ Follow");
  await followBtn.click();

  await expect(followBtn).toHaveText("Following");
  await expect(followBtn).toHaveClass(/following/);
  expect(requests.find((r) => r.action === "toggle_follow")?.author_user_id).toBe("other-user");
});

test("searching sends a real q= request to the server and shows an honest no-results state", async ({ page }) => {
  const requests = [];
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      if (url.searchParams.get("action") === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      const q = url.searchParams.get("q");
      requests.push(q);
      const items = q ? [] : [makePost()];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();
  await expect(page.locator(".community-post")).toHaveCount(1);

  await page.locator("#communitySearch").fill("nonexistent flower");
  await expect(page.locator(".community-empty")).toContainText('No posts match "nonexistent flower"', { timeout: 5_000 });
  await expect.poll(() => requests.includes("nonexistent flower")).toBe(true);
});

test("Mark as answer is a real, gated action — only the asker sees it, and it highlights the chosen comment", async ({ page }) => {
  const question = makePost({
    id: "post-question",
    is_mine: true,
    author_user_id: "me",
    category: "Questions",
    caption: "Best foam-free mechanics for a compote bowl?",
    author: { user_id: "me", display_name: "Ashley", shop_display_name: "Lilies in Bloom", city: "" },
    comment_count: 1,
  });
  let markedAnswered = null;
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      const action = url.searchParams.get("action");
      if (action === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      if (action === "comments") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "c1",
                post_id: "post-question",
                body: "Chicken wire grid works great, no foam needed.",
                is_mine: false,
                can_moderate: false,
                author: { display_name: "Jamie" },
                created_at: new Date().toISOString(),
              },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [question] }) });
    }
    const body = req.postDataJSON();
    if (body?.action === "mark_answered") {
      markedAnswered = body;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, answered_comment_id: body.comment_id }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  await page.locator('[data-post-id="post-question"] .community-toggle-comments').click();
  const markBtn = page.locator('[data-post-id="post-question"] .community-mark-answer');
  await expect(markBtn).toBeVisible();

  await markBtn.click();
  expect(markedAnswered).toEqual({ action: "mark_answered", post_id: "post-question", comment_id: "c1" });
  await expect(page.locator('[data-post-id="post-question"] .community-answer-badge')).toContainText("Answer");
  await expect(page.locator('[data-post-id="post-question"] .community-answered-tag')).toContainText("Answered");
});

test("the notifications bell shows a real unread badge and clears it once opened", async ({ page }) => {
  await mockBackend(page);
  let markedRead = false;
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      if (url.searchParams.get("action") === "notifications") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              { id: "n1", type: "like", actor: { display_name: "Jamie" }, post_id: "post-1", read: markedRead, created_at: new Date().toISOString() },
            ],
            unread_count: markedRead ? 0 : 1,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [makePost()] }) });
    }
    const body = route.request().postDataJSON();
    if (body?.action === "mark_notifications_read") {
      markedRead = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  await expect(page.locator(".community-notif-badge")).toHaveText("1");

  await page.locator("#communityNotificationsBell").click();
  await expect(page.locator(".community-notif-list li")).toContainText("Jamie encouraged your post");
  await expect(page.locator(".community-notif-badge")).toHaveCount(0);
});
