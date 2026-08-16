/**
 * Shared setup for the "simulated authenticated session" Playwright specs
 * (authenticated-tabs.spec.js, button-wiring.spec.js).
 */
import { getFeatureFlags } from "../../netlify/functions/_shared/feature-flags.js";

export const FAKE_SESSION = {
  accessToken: "fake-access-token-for-smoke-test",
  refreshToken: "fake-refresh-token-for-smoke-test",
  user: { id: "smoke-test-user", email: "smoke-test@example.invalid" },
  expiresAt: Date.now() + 60 * 60 * 1000,
};

/**
 * Mocks every external/backend call a page might make. Two important
 * details this got wrong on the first pass, worth keeping documented:
 *
 * 1. production-health needs *real* feature_flags, not an empty object.
 *    app.js's own click handlers for Community/Holiday/Email
 *    Campaigns/Weddings/Florist Network explicitly check
 *    `refreshGrowthFeatureFlags()` before navigating and show a toast +
 *    decline to navigate if a flag reads as off (see setFlaggedNavVisible
 *    in app.js) — that's correct, intentional behavior, not a bug. But it
 *    means an empty mock response makes every one of those tabs look
 *    "broken" in this suite when they're actually working exactly as
 *    designed against real production defaults (which are true for all
 *    five). Pulling the real getFeatureFlags() keeps this mock honest
 *    instead of silently testing a fictional "everything disabled" build.
 * 2. Generic {} is fine for the rest — the load functions in app.js are
 *    defensively coded (`.items || []`, optional chaining throughout)
 *    specifically so a thin/missing response degrades to an empty state
 *    instead of throwing.
 */
export async function mockBackend(page) {
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route(/fonts\.gstatic\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) }),
  );
  await page.route(/images\.pexels\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }),
  );
  // Playwright matches page.route() handlers in *reverse* registration
  // order — the most-recently-registered one runs first and can shadow an
  // earlier, more specific one. Register the generic catch-all before the
  // production-health override (not after) so the override actually wins.
  // Got this backwards on the first pass: with the specific route
  // registered first, the generic "**/.netlify/functions/**" handler
  // silently swallowed the production-health request too, so every
  // feature flag read back as false/undefined regardless of what
  // getFeatureFlags() returned below — which looked exactly like the
  // Community/Holiday/Email Campaigns/Weddings/Florist Network tabs being
  // broken, when the actual bug was in this fixture's route order.
  await page.route("**/.netlify/functions/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/.netlify/functions/production-health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, feature_flags: getFeatureFlags() }),
    }),
  );
}

export async function withFakeSession(page) {
  await page.addInitScript((session) => {
    localStorage.setItem("bloom_session", JSON.stringify(session));
    // Simulate a returning user, not a brand-new signup: showApp() calls
    // BloomFirstRun.showWelcome(), which opens a real, correctly-working
    // <dialog showModal()> onboarding overlay for first-time users (see
    // public/bloom-rc2-first-run.js — it has a working "Get started"
    // button that closes it). That's real, intentional first-run UX, not
    // a bug — but it would block every click in this suite, which is
    // testing tab navigation, not the first-run flow itself.
    localStorage.setItem("bloom_first_run_rc2_done", "1");
  }, FAKE_SESSION);
}
