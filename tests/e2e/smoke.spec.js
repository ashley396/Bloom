import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * These block genuinely external hosts (fonts, and the Netlify Functions
 * this static server doesn't implement) so the suite is fast and
 * deterministic regardless of what network access a given sandbox/CI
 * runner has — not because those calls are expected to fail in
 * production, just because a real Supabase/Stripe backend doesn't exist
 * here to answer them.
 */
async function blockExternalCalls(page) {
  // Fulfill rather than abort() — an aborted request still logs a
  // "Failed to load resource" console error in Chromium, which would
  // make every run of this suite fail its own zero-console-errors check
  // for a reason that has nothing to do with the app itself.
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route(/fonts\.gstatic\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) }),
  );
  await page.route(/images\.pexels\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }),
  );
  await page.route("**/.netlify/functions/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(new Error(msg.text()));
  });
  return errors;
}

test.describe("Florisyn public smoke", () => {
  test("the login page loads with real branding and a working sign-in form", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/login");

    await expect(page).toHaveTitle(/Sign In \| Florisyn/);
    await expect(page.locator(".auth-hero-logo strong")).toHaveText("Florisyn");
    await expect(page.locator("#loginHeading")).toBeVisible();

    const form = page.locator("#authForm");
    await expect(form).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("the signup page loads with a working account form", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/signup");

    await expect(page).toHaveTitle(/Start Free Trial \| Florisyn/);
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();

    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("a public legal page renders real content, not a 404 or blank shell", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/legal/privacy/");

    await expect(page).toHaveTitle(/Privacy Policy \| Florisyn/);
    await expect(page.locator("h1")).toHaveText("Privacy Policy");
    await expect(page.getByText(/reviewed by a qualified attorney/i)).toBeVisible();
  });

  test("the main app bundle boots end to end without a fatal script error, then shows the public marketing homepage to an unauthenticated visitor", async ({
    page,
  }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    // "/" has no session in localStorage, so app.js's own bootFloristApp()
    // calls showAuth(), which now leaves the visitor on "/" and reveals
    // the static #publicHome marketing section instead of redirecting to
    // /login. Reaching that visible, populated state at all means every
    // one of the ~60 <script> tags in index.html parsed and executed
    // without throwing — this is the single highest-value regression
    // check available without real Supabase/Stripe credentials: it
    // exercises the whole load-order chain, not just one file in
    // isolation. The URL must stay on "/" (no redirect), and the
    // authenticated app shell must stay hidden.
    await page.goto("/");

    await expect(page.locator("#publicHome")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome h1")).toContainText("Florisyn");
    await expect(page.locator("#app")).toBeHidden();
    await expect(page.locator("#auth")).toBeHidden();
    expect(page.url()).toMatch(/\/$/);

    expect(errors, `unexpected console/page errors while booting: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("an authenticated visitor never sees the public marketing homepage", async ({ page }) => {
    await blockExternalCalls(page);
    await mockBackend(page);
    await withFakeSession(page);

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome")).toBeHidden();
  });
});
