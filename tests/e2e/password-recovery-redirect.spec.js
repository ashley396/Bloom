import { test, expect } from "@playwright/test";

/**
 * Password-recovery repair: a Supabase project whose Auth "Redirect URLs"
 * allow-list doesn't yet include the exact /reset-password path (true of
 * a brand new project whose Auth URL configuration was never touched)
 * bounces a real recovery link back to the bare Site URL instead —
 * landing the florist on the public homepage or the plain sign-in form
 * with the recovery session tokens still sitting unused in the URL hash.
 * recovery-redirect-guard.js (loaded first, inline, on both those pages)
 * rescues that hash and forwards it to the real "set new password"
 * destination. auth-flows-coverage.spec.js already covers landing on
 * /reset-password directly; this file covers the forwarding path itself.
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

const RECOVERY_HASH = "#access_token=real-recovery-token&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery";

test.describe("Password recovery: forwarding a misdirected recovery link to /reset-password", () => {
  test("a recovery link landing on the site root is forwarded to the real reset-password page", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/" + RECOVERY_HASH);

    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.locator("#resetForm")).toBeVisible();
    // The hash carrying the actual recovery tokens must survive the hop —
    // this is the whole point, not just "some page loaded".
    const hash = await page.evaluate(() => location.hash);
    expect(hash).toContain("access_token=real-recovery-token");
    expect(hash).toContain("type=recovery");
  });

  test("a recovery link landing on the login page is forwarded to the real reset-password page", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/login" + RECOVERY_HASH);

    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.locator("#resetForm")).toBeVisible();
    // Never shows the plain sign-in form for what is actually a recovery session.
    await expect(page.locator("#authForm")).toHaveCount(0);
  });

  test("password update still succeeds end to end after being forwarded from the site root", async ({ page }) => {
    await blockExternalCalls(page);
    let resetBody = null;
    await page.route("**/api/auth-reset-password", async (route) => {
      resetBody = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "reset_success" }) });
    });

    await page.goto("/" + RECOVERY_HASH);
    await expect(page.locator("#resetForm")).toBeVisible();
    await page.fill("#resetPassword", "a-brand-new-password");
    await page.fill("#resetPasswordConfirm", "a-brand-new-password");
    await page.click("#resetButton");

    await expect(page.locator("#resetMessage")).toContainText("Password updated");
    expect(resetBody).toEqual({ password: "a-brand-new-password", access_token: "real-recovery-token" });
  });

  test("mismatched passwords are still caught client-side after being forwarded from login", async ({ page }) => {
    await blockExternalCalls(page);
    let apiCalled = false;
    await page.route("**/api/auth-reset-password", (route) => {
      apiCalled = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/login" + RECOVERY_HASH);
    await expect(page.locator("#resetForm")).toBeVisible();
    await page.fill("#resetPassword", "password-one");
    await page.fill("#resetPasswordConfirm", "password-two");
    await page.click("#resetButton");

    await expect(page.locator("#resetMessage")).toContainText("do not match");
    expect(apiCalled).toBe(false);
  });

  test("an expired or already-used recovery link landing directly on reset-password shows the real reason", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto(
      "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
    );

    await expect(page.locator("#resetForm")).toBeHidden();
    await expect(page.locator("#resetMessage")).toContainText("Email link is invalid or has expired");
    // The dedicated escape hatch is always available regardless of message state.
    await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
  });

  test("normal login with no recovery hash is completely unaffected by the guard", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/api/auth-login", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid email or password.", code: "invalid_credentials" }),
      }),
    );

    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#authForm")).toBeVisible();

    await page.fill("#email", "florist@example.invalid");
    await page.fill("#password", "whatever-they-typed");
    await page.click("#authForm button[type='submit']");

    await expect(page.locator("#authMessage")).toContainText("Could not sign in");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("normal homepage visit with no recovery hash is completely unaffected by the guard", async ({ page }) => {
    await blockExternalCalls(page);

    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#publicHome")).toBeVisible();
  });
});
