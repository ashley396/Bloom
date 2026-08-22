import { test, expect } from "@playwright/test";
import { withFakeSession } from "./fixtures.mjs";

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

  test("the /resources hub renders all 15 category cards and links resolve", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/resources/");

    await expect(page).toHaveTitle(/Florist Business Resources \| Florisyn/);
    await expect(page.locator(".rc-hub-card")).toHaveCount(15);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("a high-intent landing page renders its hero, features, and FAQ", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/florist-pos/");

    await expect(page).toHaveTitle(/Florist POS Software/);
    await expect(page.locator("h1")).toContainText("point-of-sale system");
    await expect(page.locator(".info-card")).not.toHaveCount(0);
    await expect(page.locator(".rc-faq-item")).not.toHaveCount(0);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("a resource article renders as a standalone guide, not just a product pitch", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/resources/how-to-price-floral-arrangements/");

    await expect(page).toHaveTitle(/How to Price Floral Arrangements/);
    await expect(page.locator("h1")).toHaveText("How to price floral arrangements");
    await expect(page.locator(".rc-quicklook table")).toBeVisible();
  });

  test("a seasonal-authority article gives real operational guidance, not just promotion", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/resources/valentines-day-prep/");

    await expect(page).toHaveTitle(/Valentine's Day Prep/);
    await expect(page.locator("h1")).toHaveText("Valentine's Day prep for flower shops");
    await expect(page.locator(".rc-step")).not.toHaveCount(0);
    await expect(page.locator(".rc-checklist li")).not.toHaveCount(0);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("the comparison page cites real sources and doesn't claim Florisyn wins every category", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/company/compare/");

    await expect(page).toHaveTitle(/Compare Florisyn/);
    await expect(page.getByRole("heading", { name: "Where Florisyn doesn't win" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "References", exact: true })).toBeVisible();
    await expect(page.locator(".compare-table .strength")).not.toHaveCount(0);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("the florist glossary defines every term and links to the pages that expand on them", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/resources/florist-glossary/");

    await expect(page).toHaveTitle(/Florist Business Glossary/);
    await expect(page.locator("#cogs")).toBeVisible();
    await expect(page.locator("#wire-service")).toBeVisible();
    await expect(page.locator(".rc-faq-item")).toHaveCount(15);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("the Founding Florists page states the real 14-day trial and no fabricated spot cap", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    await page.goto("/company/founding-florists/");

    await expect(page).toHaveTitle(/Founding Florists/);
    await expect(page.locator("h1")).toContainText("made from the florist's side of the counter");
    await expect(page.getByText("14-day free trial", { exact: false }).first()).toBeVisible();
    // The page correctly explains what it ISN'T ("it isn't a special
    // 30-day trial") — that's a deliberate disclaimer, not the claim
    // itself. What must never appear is the fabricated claim as a
    // positive promise.
    await expect(page.getByText("30 days free", { exact: false })).toHaveCount(0);
    await expect(page.getByText("20 Founding Florists", { exact: false })).toHaveCount(0);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("the main app bundle boots end to end without a fatal script error, then shows the public marketing homepage to an unauthenticated visitor", async ({
    page,
  }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    // "/" has no session in localStorage, so app.js's own bootFloristApp()
    // calls showAuth(), which now leaves the visitor on "/" and reveals
    // the static #publicHome marketing section instead of redirecting to
    // /login (production routing bug: a brand-new visitor was being sent
    // straight to the login form instead of Florisyn's public landing
    // page). Reaching that visible, populated state at all means every
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
    await withFakeSession(page);

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome")).toBeHidden();
  });

  test("/login and /signup still work as their own dedicated pages, unaffected by the public homepage now living at \"/\"", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/login");
    await expect(page).toHaveTitle(/Sign In \| Florisyn/);
    await expect(page.locator("#authForm")).toBeVisible();

    await page.goto("/signup");
    await expect(page).toHaveTitle(/Start Free Trial \| Florisyn/);
    await expect(page.locator("#signupForm")).toBeVisible();
  });

  test("the public homepage renders correctly on a phone-width viewport too, with no horizontal overflow", async ({ page }) => {
    await blockExternalCalls(page);
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone-class width

    await page.goto("/");

    await expect(page.locator("#publicHome")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome h1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start Free Trial" }).first()).toBeVisible();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, "page must not scroll horizontally on a phone-width viewport").toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe("Florisyn marketing-site analytics beacon (first-party, non-invasive)", () => {
  test("a public page load fires a sanitized pageview beacon — no cookies, no full referrer URL, no PII", async ({ page }) => {
    await blockExternalCalls(page);
    const errors = collectPageErrors(page);

    const beaconRequest = page.waitForRequest((req) => req.url().includes("/.netlify/functions/site-analytics"));
    await page.goto("/company/pricing/");
    const req = await beaconRequest;

    const payload = JSON.parse(req.postData());
    expect(payload.event_type).toBe("site_pageview");
    expect(payload.path).toBe("/company/pricing/");
    // The client only ever sends a bare referrer/landing_referrer string
    // (document.referrer, empty on direct nav in this test) for the
    // server to reduce to a hostname — it never sends cookies, an email,
    // or any persistent identifier. session_id is an ephemeral
    // sessionStorage-only value, not a tracking cookie.
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("ip");
    expect(typeof payload.session_id === "string" || payload.session_id === null).toBe(true);

    expect((await page.context().cookies()).length).toBe(0);
    expect(errors, `unexpected console/page errors: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test("clicking a pricing plan's signup CTA fires a site_cta_click beacon carrying that plan's real tier code", async ({ page }) => {
    await blockExternalCalls(page);
    await page.goto("/company/pricing/");

    // pricing.js overwrites the static CTA markup on load (mountPricingToggle) —
    // this exercises the JS-rendered card, not just the static HTML fallback.
    const premiumCta = page.locator('[data-cta="pricing-premium-signup"]');
    await expect(premiumCta).toBeVisible();

    const beaconRequest = page.waitForRequest(
      (req) => req.url().includes("/.netlify/functions/site-analytics") && req.postData()?.includes("site_cta_click"),
    );
    await premiumCta.click();
    const req = await beaconRequest;

    const payload = JSON.parse(req.postData());
    expect(payload.event_type).toBe("site_cta_click");
    expect(payload.cta_id).toBe("pricing-premium-signup");
  });

  test("a completed signup fires a site_signup_conversion beacon", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/.netlify/functions/auth-signup", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "fake-token", refreshToken: "fake-refresh", user: { id: "u1" } }),
      }),
    );
    await page.route("**/api/auth-signup", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "fake-token", refreshToken: "fake-refresh", user: { id: "u1" } }),
      }),
    );

    await page.goto("/signup");
    await page.locator("#fullName").fill("Sarah Bloom");
    await page.locator("#shopName").fill("Sarah's Flowers");
    await page.locator("#email").fill("sarah@example.com");
    await page.locator("#password").fill("a-strong-password-1");
    await page.locator("#businessPhone").fill("555-123-4567");
    await page.locator("#businessAddress").fill("1 Main St");
    await page.locator("#businessCity").fill("Louisville");
    await page.locator("#businessState").fill("KY");
    await page.locator("#businessZip").fill("40202");
    await page.locator("#agreeTerms").check();

    const beaconRequest = page.waitForRequest(
      (req) => req.url().includes("/.netlify/functions/site-analytics") && req.postData()?.includes("site_signup_conversion"),
    );
    await page.locator("#signupForm button[type='submit']").click();
    const req = await beaconRequest;

    const payload = JSON.parse(req.postData());
    expect(payload.event_type).toBe("site_signup_conversion");
    expect(payload.cta_id).toBe("signup");
  });
});
