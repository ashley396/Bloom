import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_PLATFORMS,
  isPlatformConfigured,
  isPlatformLive,
  buildSocialProviderRegistry,
  buildConfiguredSocialProviderRegistry
} from "../netlify/functions/_shared/marketing-social-providers.js";

test("buildSocialProviderRegistry: every platform is not-live, with none omitted", () => {
  const registry = buildSocialProviderRegistry();
  assert.deepEqual(Object.keys(registry).sort(), [...SUPPORTED_PLATFORMS].sort());
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(registry[platform].platform, platform);
  }
});

test("isPlatformLive: always false today — no platform has cleared a real, verified live check yet", () => {
  for (const platform of SUPPORTED_PLATFORMS) assert.equal(isPlatformLive(platform), false);
});

test("buildConfiguredSocialProviderRegistry: with no env credentials configured, every platform (even the OAuth-architected ones) resolves to the not-live stub", () => {
  const registry = buildConfiguredSocialProviderRegistry({ env: {} });
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(registry[platform].platform, platform);
  }
  // A not-live provider always throws — verified for the three platforms
  // that do have a real adapter available, since those are the only ones
  // that could be mistakenly wired in when unconfigured.
  return Promise.all(
    ["facebook", "instagram", "tiktok"].map((platform) => assert.rejects(() => registry[platform].publish({}), /connection required|access token|no target account/))
  );
});

test("buildConfiguredSocialProviderRegistry: facebook credentials configured — facebook gets the real adapter, instagram/tiktok stay not-live", async () => {
  const env = { FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID: "id", FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET: "secret" };
  const registry = buildConfiguredSocialProviderRegistry({ env });

  // The real facebook adapter validates its OWN required call-time
  // context (accessToken/externalAccountId) — a distinct error shape from
  // the not-live stub's generic "connection required" message — proving
  // this is genuinely the real adapter, not still the stub.
  await assert.rejects(() => registry.facebook.publish({}), /access token/);
  await assert.rejects(() => registry.instagram.publish({}), /connection required/);
  await assert.rejects(() => registry.tiktok.publish({}), /connection required/);
});

test("buildConfiguredSocialProviderRegistry: a platform with no real adapter yet (e.g. linkedin) stays not-live even if credentials were somehow set", async () => {
  const env = { FLORISYN_SOCIAL_LINKEDIN_CLIENT_ID: "id", FLORISYN_SOCIAL_LINKEDIN_CLIENT_SECRET: "secret" };
  const registry = buildConfiguredSocialProviderRegistry({ env });
  await assert.rejects(() => registry.linkedin.publish({}), /connection required/);
});

test("isPlatformConfigured: requires BOTH env vars, never just one", () => {
  assert.equal(isPlatformConfigured("facebook", {}), false);
  assert.equal(isPlatformConfigured("facebook", { FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID: "id" }), false);
  assert.equal(isPlatformConfigured("facebook", { FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID: "id", FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET: "secret" }), true);
});
