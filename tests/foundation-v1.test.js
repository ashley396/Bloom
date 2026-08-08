import test from "node:test";
import assert from "node:assert/strict";
import { getAiProviderStatus, AI_STATUS } from "../netlify/functions/_shared/ai-status.js";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";
import {
  normalizeOrderStatus,
  orderStatusLabel,
} from "../netlify/functions/_shared/order-status.js";
import {
  authRedirectPath,
  resolvePublicSiteUrl,
} from "../netlify/functions/_shared/site-url.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

test("normalizeOrderStatus maps legacy NEW to PENDING", () => {
  assert.equal(normalizeOrderStatus("NEW"), "PENDING");
  assert.equal(orderStatusLabel("DESIGNING"), "Designing");
});

test("getAiProviderStatus is honest without credentials", () => {
  const status = getAiProviderStatus({});
  assert.equal(status.state, AI_STATUS.CONFIGURATION_REQUIRED);
  assert.notEqual(status.lily, "online");
});

test("getAiProviderStatus reports online when Cloudflare is configured", () => {
  const status = getAiProviderStatus({
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_AI_API_TOKEN: "token",
  });
  assert.equal(status.state, AI_STATUS.ONLINE);
});

test("getAiProviderStatus ignores OpenAI credentials for cost control", () => {
  const status = getAiProviderStatus({ OPENAI_API_KEY: "sk-test-not-used" });
  assert.equal(status.state, AI_STATUS.CONFIGURATION_REQUIRED);
  assert.equal(status.provider, null);
  assert.equal(status.lily, "offline");
});

test("feature flags default voice wake off", () => {
  assert.equal(isFeatureEnabled("VOICE_WAKE", {}), false);
});

test("auth redirect never uses localhost when SITE_URL is set", () => {
  const redirect = authRedirectPath(
    { SITE_URL: "https://shop.example.com", URL: "http://localhost:8888" },
    "http://localhost:8888",
    "/verify-email",
  );
  assert.doesNotMatch(redirect, /localhost/);
});

test("sympathy-funeral-spray asset exists on disk", () => {
  const path = join(
    process.cwd(),
    "frontend/public/assets/floristry/sympathy-funeral-spray.jpg",
  );
  assert.ok(existsSync(path));
});
