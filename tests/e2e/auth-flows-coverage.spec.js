import { test, expect } from "@playwright/test";
import { FAKE_SESSION, withFakeSession } from "./fixtures.mjs";

/**
 * Launch-repair Area 1 (Authentication): coverage for the auth sub-flows
 * PR #168 didn't touch — wrong password, forgot password, password reset
 * (valid + expired link), an already-registered signup attempt, returning
 * -user session restore, and logout. verify-email.spec.js already covers
 * signup -> pending -> confirm -> login and the unconfirmed-account error;
 * this file fills in the rest of the list from the launch-repair spec.
 */

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

test.describe("Florisyn auth flows: login, password recovery, signup edge cases, logout", () => {
  test("wrong password gets an honest invalid-credentials error, not a dead end", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/api/auth-login", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid email or password.", code: "invalid_credentials" }),
      }),
    );

    await page.goto("/login");
    await page.fill("#email", "florist@example.invalid");
    await page.fill("#password", "the-wrong-password");
    await page.click("#authForm button[type='submit']");

    await expect(page.locator("#authMessage")).toContainText("Could not sign in");
    await expect(page.locator("#authMessage a", { hasText: /reset your password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    // Never navigated away on failure.
    await expect(page).toHaveURL(/\/login$/);
  });

  test("forgot password: submitting a real email shows the same accepted message the backend sends", async ({ page }) => {
    await blockExternalCalls(page);
    let requestedEmail = null;
    await page.route("**/api/auth-forgot-password", async (route) => {
      requestedEmail = JSON.parse(route.request().postData() || "{}").email;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          code: "recover_accepted",
          message: "If an account exists for this email, you will receive password reset instructions shortly.",
        }),
      });
    });

    await page.goto("/forgot-password");
    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");

    await expect(page.locator("#forgotMessage")).toContainText("you will receive password reset instructions");
    expect(requestedEmail).toBe("florist@example.invalid");
  });

  test("password reset: a real recovery link (hash access_token + type=recovery) lets the florist set a new password", async ({ page }) => {
    await blockExternalCalls(page);
    let resetBody = null;
    await page.route("**/api/auth-reset-password", async (route) => {
      resetBody = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "reset_success" }) });
    });

    await page.goto("/reset-password#access_token=real-recovery-token&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery");

    await expect(page.locator("#resetForm")).toBeVisible();
    await page.fill("#resetPassword", "a-brand-new-password");
    await page.fill("#resetPasswordConfirm", "a-brand-new-password");
    await page.click("#resetButton");

    await expect(page.locator("#resetMessage")).toContainText("Password updated");
    expect(resetBody).toEqual({ password: "a-brand-new-password", access_token: "real-recovery-token" });
  });

  test("password reset: an expired/missing recovery link is reported honestly and never shows the password form", async ({ page }) => {
    await blockExternalCalls(page);

    // No hash at all — e.g. the link was already used, or copy-pasted
    // without its fragment.
    await page.goto("/reset-password");

    await expect(page.locator("#resetForm")).toBeHidden();
    await expect(page.locator("#resetMessage")).toContainText("missing or expired");
  });

  test("password reset: mismatched passwords are caught client-side before hitting the API", async ({ page }) => {
    await blockExternalCalls(page);
    let apiCalled = false;
    await page.route("**/api/auth-reset-password", (route) => {
      apiCalled = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/reset-password#access_token=real-recovery-token&type=recovery");
    await page.fill("#resetPassword", "password-one");
    await page.fill("#resetPasswordConfirm", "password-two");
    await page.click("#resetButton");

    await expect(page.locator("#resetMessage")).toContainText("do not match");
    expect(apiCalled).toBe(false);
  });

  test("signing up with an email that's already registered gets an honest error, not a duplicate account", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/api/auth-signup", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "An account with this email may already exist. Sign in or use Forgot Password.",
          code: "account_already_registered",
        }),
      }),
    );

    await page.goto("/signup");
    await page.fill("#fullName", "Jamie Rivera");
    await page.fill("#shopName", "Rivera Blooms");
    await page.fill("#email", "already-a-florist@example.invalid");
    await page.fill("#password", "correct-horse-battery");
    await page.fill("#businessPhone", "555-010-1234");
    await page.fill("#businessAddress", "1 Market St");
    await page.fill("#businessCity", "Austin");
    await page.fill("#businessState", "tx");
    await page.fill("#businessZip", "78701");
    await page.check("#agreeTerms");
    await page.click("#signupForm button[type='submit']");

    await expect(page.getByText(/may already exist/i)).toBeVisible();
    // Never redirected to the pending-confirmation page for a duplicate.
    await expect(page).not.toHaveURL(/verify-email/);
  });

  test("a returning user's session is restored on reload straight into the dashboard, no re-login", async ({ page }) => {
    await withFakeSession(page);
    await blockExternalCalls(page);

    await page.goto("/dashboard");

    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#publicHome")).toBeHidden();
    await expect(page).toHaveURL(/\/dashboard$/);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bloom_session") || "null"));
    expect(stored?.accessToken).toBe(FAKE_SESSION.accessToken);
  });

  test("logout clears the session and returns to the login page; the session cannot be restored afterward", async ({ page }) => {
    // Deliberately not using the shared withFakeSession fixture here: it
    // uses page.addInitScript, which Playwright reruns on *every* new
    // document in this browsing context — including the /login page that
    // logout itself navigates to — which would silently re-inject the fake
    // session right after the real clearSession() removed it and make this
    // test pass even if logout stopped clearing anything. A sessionStorage
    // marker (preserved across same-tab navigations, unlike a fresh
    // localStorage plant) makes the injection genuinely one-shot instead.
    await page.addInitScript((session) => {
      if (!sessionStorage.getItem("_e2e_session_injected_once")) {
        localStorage.setItem("bloom_session", JSON.stringify(session));
        localStorage.setItem("bloom_first_run_rc2_done", "1");
        sessionStorage.setItem("_e2e_session_injected_once", "1");
      }
    }, FAKE_SESSION);
    await blockExternalCalls(page);

    await page.goto("/dashboard");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    await page.click("#logout");
    await expect(page).toHaveURL(/\/login$/);

    const stored = await page.evaluate(() => localStorage.getItem("bloom_session"));
    expect(stored).toBeNull();

    // Reloading the app root now shows the public marketing homepage /
    // login gate, not the authenticated app, proving the session is
    // actually gone rather than just visually hidden.
    await page.goto("/dashboard");
    await expect(page.locator("#app")).toBeHidden();
  });
});
