import { test, expect } from "@playwright/test";

/**
 * Covers the signup -> confirmation -> login journey end to end in a real
 * browser. This exists because of a real production bug: /verify-email
 * used to treat its own `?confirmed=1` redirect flag (baked into the email
 * link by our code, before any verification happens) as proof the account
 * was actually confirmed — so it showed "Email confirmed" unconditionally,
 * even when Supabase's real server-side check had failed. Supabase's own
 * /auth/v1/verify redirect carries the real signal: session tokens in the
 * URL *hash* fragment on success, `error`/`error_code` (hash or query) on
 * failure. These tests drive the page with those real signals instead of
 * trusting the page's own pre-set flag, the same way a real email click
 * would.
 */

const SIGNUP_ENDPOINT = "**/api/auth-signup";
const RESEND_ENDPOINT = "**/api/auth-resend-confirmation";
const LOGIN_ENDPOINT = "**/api/auth-login";

async function blockExternalCalls(page) {
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

test.describe("Florisyn signup -> email confirmation -> login", () => {
  test("a new signup with a branded provider configured lands on the honest pending-confirmation page", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route(SIGNUP_ENDPOINT, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: null,
          refreshToken: null,
          user: { id: "new-user-1", email: "new-florist@example.invalid" },
          confirmationRequired: true,
          confirmationEmailSent: true,
          confirmationEmailProvider: "resend",
        }),
      }),
    );

    await page.goto("/signup");
    await page.fill("#fullName", "Jamie Rivera");
    await page.fill("#shopName", "Rivera Blooms");
    await page.fill("#email", "new-florist@example.invalid");
    await page.fill("#password", "correct-horse-battery");
    await page.fill("#businessPhone", "555-010-1234");
    await page.fill("#businessAddress", "1 Market St");
    await page.fill("#businessCity", "Austin");
    await page.fill("#businessState", "tx");
    await page.fill("#businessZip", "78701");
    await page.check("#agreeTerms");
    await page.click("#signupForm button[type='submit']");

    await expect(page).toHaveURL(/\/verify-email\?pending=1&sent=1&email=/);
    await expect(page.locator("#verifyTitle")).toHaveText("Confirm your email");
    await expect(page.getByText(/We sent a confirmation link/i)).toBeVisible();
    await expect(page.locator("#resendConfirmationForm")).toBeVisible();
  });

  test("clicking the real confirmation link (Supabase hash tokens) shows a genuine confirmed state", async ({ page }) => {
    await blockExternalCalls(page);

    // A real Supabase /auth/v1/verify success redirect: session tokens in
    // the hash fragment, our own confirmed=1 flag also present (we set it
    // in redirect_to) — the hash must be what actually drives the UI.
    await page.goto("/verify-email?confirmed=1#access_token=fake-token&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=signup");

    await expect(page.locator("#verifyTitle")).toHaveText("Email confirmed");
    await expect(page.getByText(/your email is verified/i)).toBeVisible();
    await expect(page.locator("#resendConfirmationForm")).toBeHidden();
  });

  test("an expired or already-used confirmation link is reported honestly, not as success", async ({ page }) => {
    await blockExternalCalls(page);

    // A real Supabase /auth/v1/verify failure redirect.
    await page.goto("/verify-email?confirmed=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");

    await expect(page.locator("#verifyTitle")).toHaveText("Verification link expired");
    await expect(page.getByText(/Email link is invalid or has expired/i)).toBeVisible();
    await expect(page.locator("#resendConfirmationForm")).toBeVisible();
  });

  test("visiting the bare confirmed=1 URL with no real Supabase signal never claims a false confirmation", async ({ page }) => {
    await blockExternalCalls(page);

    // No hash tokens, no error — e.g. a stale bookmark or a reload of this
    // exact URL, not a fresh click straight from the email.
    await page.goto("/verify-email?confirmed=1");

    await expect(page.locator("#verifyTitle")).not.toHaveText("Email confirmed");
    await expect(page.locator("#verifyTitle")).toHaveText("Check your email");
    await expect(page.locator("#resendConfirmationForm")).toBeVisible();
  });

  test("resending the confirmation email works from the pending page", async ({ page }) => {
    await blockExternalCalls(page);
    let resendCalledWith = null;
    await page.route(RESEND_ENDPOINT, async (route) => {
      resendCalledWith = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          code: "resend_accepted",
          confirmationEmailSent: true,
          message: "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly.",
        }),
      });
    });

    await page.goto("/verify-email?pending=1&sent=1&email=new-florist%40example.invalid");
    await expect(page.locator("#resendEmail")).toHaveValue("new-florist@example.invalid");
    await page.click("#resendButton");

    await expect(page.getByText(/new confirmation link will arrive shortly/i)).toBeVisible();
    expect(resendCalledWith?.email).toBe("new-florist@example.invalid");
  });

  test("a confirmed account can sign in and reach the app", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route(LOGIN_ENDPOINT, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          expiresIn: 3600,
          user: { id: "new-user-1", email: "new-florist@example.invalid" },
        }),
      }),
    );

    await page.goto("/login");
    await page.fill("#email", "new-florist@example.invalid");
    await page.fill("#password", "correct-horse-battery");
    await page.click("#authForm button[type='submit']");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome")).toBeHidden();
  });

  test("an unconfirmed account gets an honest, actionable error on login instead of a dead end", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route(LOGIN_ENDPOINT, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Email not confirmed. Check your inbox or resend the confirmation email.", code: "email_not_confirmed" }),
      }),
    );

    await page.goto("/login");
    await page.fill("#email", "still-unconfirmed@example.invalid");
    await page.fill("#password", "correct-horse-battery");
    await page.click("#authForm button[type='submit']");

    await expect(page.locator("#authMessage")).toContainText("Could not sign in yet");
    const resendLink = page.locator("#authMessage a");
    await expect(resendLink).toHaveAttribute("href", /\/verify-email\?pending=1&email=/);
  });
});
