import { test, expect } from "@playwright/test";

/**
 * The case studies page's fetch("/.netlify/functions/referral-program...")
 * had no .catch() and no r.ok check — a non-2xx response, or one that
 * wasn't valid JSON, threw an uncaught error and left the whole case
 * studies section blank with nothing but a silent console error. Verifies
 * a failed fetch now surfaces a real, friendly message instead.
 */
test("case studies page shows a friendly message, not a blank section, when the API call fails", async ({ page }) => {
  await page.route("**/.netlify/functions/referral-program**", (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "server error" }),
  );

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/company/case-studies/");
  await expect(page.locator("#caseStudiesGrid")).not.toBeEmpty();
  await expect(page.locator("#caseStudiesGrid")).toContainText(/unavailable|check back/i);
  expect(errors, `uncaught error(s): ${errors.join("; ")}`).toHaveLength(0);
});
