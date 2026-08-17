import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.FLORISYN_SMOKE_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Minimal Playwright smoke suite — no Supabase/Stripe credentials exist in
// CI/local dev sandboxes, so this deliberately does not try to exercise
// authenticated app flows. It answers one question fast: does the shipped
// public/ bundle actually boot in a real browser (every <script> loads,
// nothing throws before first paint) and do the real unauthenticated
// entry points (login, signup, legal pages) render. See tests/e2e/README.md.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // This sandbox pre-installs Chromium outside Playwright's own
        // managed cache; point at it directly instead of trying to
        // download a version-matched browser.
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
  ],
  webServer: {
    command: `node tests/e2e/static-server.mjs ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
