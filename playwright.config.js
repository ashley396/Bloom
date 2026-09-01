import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.FLORISYN_SMOKE_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Batch 6, Part J: "do not hardcode a machine-specific Playwright browser
// path." This sandbox happens to pre-install Chromium outside Playwright's
// own managed cache at this fixed path, so use it directly ONLY when it's
// actually there; a real CI runner (or any other machine) has no reason to
// have this path, and must fall through to Playwright's own normal
// resolution (its managed browser cache, installed via
// `playwright install chromium`) instead of failing to launch at all.
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const sandboxChromiumExists = (() => {
  try {
    return fs.existsSync(SANDBOX_CHROMIUM_PATH);
  } catch {
    return false;
  }
})();

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
        // Portable: only override launch with the sandbox's fixed path
        // when it's genuinely present. Everywhere else (CI included),
        // omitting executablePath lets Playwright launch its own
        // normally-installed/managed browser.
        ...(sandboxChromiumExists ? { launchOptions: { executablePath: SANDBOX_CHROMIUM_PATH } } : {}),
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
