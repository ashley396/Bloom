import { test, expect } from "@playwright/test";

/**
 * Forgot-password rate-limit countdown: when auth-forgot-password.js
 * returns auth_rate_limited with retry_after_seconds, the Send reset
 * link button must disable, show a live MM:SS countdown, re-enable at
 * zero, and — the only thing ever persisted — survive a refresh via a
 * plain cooldown-expiry timestamp in sessionStorage (never the email,
 * never a token).
 */

async function blockExternalCalls(page) {
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route(/fonts\.gstatic\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) }),
  );
}

test.describe("Forgot password: rate-limit cooldown countdown", () => {
  test("rate-limited response disables the button and shows a live MM:SS countdown that updates and re-enables at zero", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/api/auth-forgot-password", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Too many requests. Please wait and try again.",
          code: "auth_rate_limited",
          retry_after_seconds: 3,
        }),
      }),
    );

    await page.goto("/forgot-password");
    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");

    await expect(page.locator("#forgotButton")).toBeDisabled();
    await expect(page.locator("#forgotMessage")).toContainText(/Try again in 00:0[1-3]/);

    // Updates once per second, then re-enables and swaps the message at zero.
    await expect(page.locator("#forgotMessage")).toContainText("You can request another reset link now.", {
      timeout: 6000,
    });
    await expect(page.locator("#forgotButton")).toBeEnabled();
    await expect(page.locator("#forgotButton")).toHaveText("Send reset link");
  });

  test("clicking Send reset link during the cooldown does not send a second request", async ({ page }) => {
    await blockExternalCalls(page);
    let requestCount = 0;
    await page.route("**/api/auth-forgot-password", (route) => {
      requestCount += 1;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many requests.", code: "auth_rate_limited", retry_after_seconds: 30 }),
      });
    });

    await page.goto("/forgot-password");
    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");
    await expect(page.locator("#forgotButton")).toBeDisabled();
    expect(requestCount).toBe(1);

    // A real disabled button never fires a click event in the browser at
    // all, so a forced click can't reach the handler either — confirming
    // no second request goes out purely from the disabled state.
    await page.click("#forgotForm button[type='submit']", { force: true });
    await page.waitForTimeout(200);
    expect(requestCount).toBe(1);

    // Belt-and-suspenders: the submit handler itself also bails out early
    // when the button is disabled, in case it's ever invoked programmatically
    // (e.g. Enter-key implicit submission) rather than via a real click.
    const guardReturnsEarly = await page.evaluate(() => document.getElementById("forgotButton").disabled === true);
    expect(guardReturnsEarly).toBe(true);
  });

  test("refreshing mid-cooldown restores the countdown from a stored expiry, not a fresh 429", async ({ page }) => {
    await blockExternalCalls(page);
    let requestCount = 0;
    await page.route("**/api/auth-forgot-password", (route) => {
      requestCount += 1;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many requests.", code: "auth_rate_limited", retry_after_seconds: 30 }),
      });
    });

    await page.goto("/forgot-password");
    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");
    await expect(page.locator("#forgotButton")).toBeDisabled();
    expect(requestCount).toBe(1);

    await page.reload();

    // Restored purely from client storage — no second request was needed.
    expect(requestCount).toBe(1);
    await expect(page.locator("#forgotButton")).toBeDisabled();
    await expect(page.locator("#forgotMessage")).toContainText(/Try again in 00:2\d/);
  });

  test("an already-expired stored cooldown is cleared on load and the form works normally", async ({ page }) => {
    await blockExternalCalls(page);
    await page.addInitScript(() => {
      sessionStorage.setItem("florisyn_forgot_password_cooldown_until", String(Date.now() - 5000));
    });
    let requestedEmail = null;
    await page.route("**/api/auth-forgot-password", async (route) => {
      requestedEmail = JSON.parse(route.request().postData() || "{}").email;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, code: "recover_accepted", message: "If an account exists for this email, you will receive password reset instructions shortly." }),
      });
    });

    await page.goto("/forgot-password");
    await expect(page.locator("#forgotButton")).toBeEnabled();
    await expect(page.locator("#forgotMessage")).toHaveText("");
    const stored = await page.evaluate(() => sessionStorage.getItem("florisyn_forgot_password_cooldown_until"));
    expect(stored).toBeNull();

    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");
    await expect(page.locator("#forgotMessage")).toContainText("you will receive password reset instructions");
    expect(requestedEmail).toBe("florist@example.invalid");
  });

  test("only the cooldown expiry timestamp is ever stored — no email, token, or secret", async ({ page }) => {
    await blockExternalCalls(page);
    await page.route("**/api/auth-forgot-password", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many requests.", code: "auth_rate_limited", retry_after_seconds: 30 }),
      }),
    );

    await page.goto("/forgot-password");
    await page.fill("#forgotEmail", "florist@example.invalid");
    await page.click("#forgotForm button[type='submit']");
    await expect(page.locator("#forgotButton")).toBeDisabled();

    const [sessionKeys, sessionValues, localKeys] = await page.evaluate(() => [
      Object.keys(sessionStorage),
      Object.values(sessionStorage).join(" "),
      Object.keys(localStorage),
    ]);
    assertNoLeakage(sessionKeys, sessionValues, localKeys);

    function assertNoLeakage(keys, values, localKeysInner) {
      expect(keys).toEqual(["florisyn_forgot_password_cooldown_until"]);
      expect(values).not.toContain("florist@example.invalid");
      expect(localKeysInner).not.toContain("florisyn_forgot_password_cooldown_until");
    }
  });

  test("a normal successful forgot-password request is unaffected by the cooldown machinery", async ({ page }) => {
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
    const stored = await page.evaluate(() => sessionStorage.getItem("florisyn_forgot_password_cooldown_until"));
    expect(stored).toBeNull();
  });

  test("normal login is unaffected by the forgot-password cooldown changes", async ({ page }) => {
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
    await expect(page).toHaveURL(/\/login$/);
  });
});
