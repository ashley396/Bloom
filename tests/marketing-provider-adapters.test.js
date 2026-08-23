import test from "node:test";
import assert from "node:assert/strict";
import {
  CLONE_NOT_LIVE,
  notLiveCloneProvider,
  selectCloneProvider
} from "../netlify/functions/_shared/marketing-clone-providers.js";
import {
  SOCIAL_NOT_LIVE,
  SUPPORTED_PLATFORMS,
  notLiveSocialProvider,
  buildSocialProviderRegistry,
  isPlatformLive,
  platformOAuthEnvVarNames,
  isPlatformConfigured
} from "../netlify/functions/_shared/marketing-social-providers.js";

// ── AI Clone adapter contract ──────────────────────────────────────────

const CLONE_METHODS = [
  "createAvatarProfile",
  "createVoiceProfile",
  "generateVideo",
  "generateVoice",
  "preview",
  "estimateCost",
  "getJobStatus",
  "cancelJob",
  "deleteProfile"
];

test("notLiveCloneProvider implements every method Section 12's conceptual interface requires", () => {
  for (const method of CLONE_METHODS) {
    assert.equal(typeof notLiveCloneProvider[method], "function", `missing clone.${method}()`);
  }
});

test("notLiveCloneProvider: every method rejects with the CLONE_NOT_LIVE code — never a silent fake success", async () => {
  for (const method of CLONE_METHODS) {
    await assert.rejects(() => notLiveCloneProvider[method]({}), (err) => {
      assert.equal(err.code, CLONE_NOT_LIVE);
      assert.equal(err.statusCode, 501);
      return true;
    }, `clone.${method}() must reject as not-live`);
  }
});

test("selectCloneProvider: with no configured providers, falls back to the not-live adapter rather than throwing", () => {
  const provider = selectCloneProvider({}, {});
  assert.equal(provider, notLiveCloneProvider);
});

test("selectCloneProvider: a configured provider is returned once one exists in the registry", () => {
  const fake = { name: "fake_provider" };
  const provider = selectCloneProvider({}, { fake_provider: fake });
  assert.equal(provider, fake);
});

// ── Social publishing adapter contract ─────────────────────────────────

const SOCIAL_METHODS = [
  "connect",
  "refreshToken",
  "validateMedia",
  "publish",
  "schedule",
  "getStatus",
  "fetchAnalytics",
  "disconnect"
];

test("SUPPORTED_PLATFORMS matches the seven networks the build directive requires (Section 19)", () => {
  assert.deepEqual(
    [...SUPPORTED_PLATFORMS].sort(),
    ["facebook", "google_business", "instagram", "linkedin", "pinterest", "tiktok", "youtube"].sort()
  );
});

test("notLiveSocialProvider implements every method Section 20's conceptual interface requires, for every supported platform", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    const adapter = notLiveSocialProvider(platform);
    assert.equal(adapter.platform, platform);
    for (const method of SOCIAL_METHODS) {
      assert.equal(typeof adapter[method], "function", `${platform}: missing social.${method}()`);
    }
  }
});

test("notLiveSocialProvider: every method rejects with the SOCIAL_NOT_LIVE code and names the platform — never a silent fake publish", async () => {
  const adapter = notLiveSocialProvider("pinterest");
  for (const method of SOCIAL_METHODS) {
    await assert.rejects(() => adapter[method]({}), (err) => {
      assert.equal(err.code, SOCIAL_NOT_LIVE);
      assert.equal(err.statusCode, 501);
      assert.equal(err.platform, "pinterest");
      return true;
    }, `social.${method}() must reject as not-live`);
  }
});

test("notLiveSocialProvider: an unrecognized platform name still returns a safe, non-throwing adapter labeled 'unknown'", () => {
  const adapter = notLiveSocialProvider("not_a_real_platform");
  assert.equal(adapter.platform, "unknown");
});

test("buildSocialProviderRegistry returns exactly one adapter per supported platform, keyed by platform name", () => {
  const registry = buildSocialProviderRegistry();
  assert.deepEqual(Object.keys(registry).sort(), [...SUPPORTED_PLATFORMS].sort());
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(registry[platform].platform, platform);
  }
});

test("isPlatformLive: no platform is reported live yet — Stage E has connected zero real providers", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(isPlatformLive(platform), false, `${platform} must not be reported live until a real adapter is wired`);
  }
});

test("platformOAuthEnvVarNames: names two distinct, consistently-prefixed env vars per platform", () => {
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames("facebook");
  assert.equal(clientIdVar, "FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID");
  assert.equal(clientSecretVar, "FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET");
  assert.notEqual(clientIdVar, clientSecretVar);
});

test("isPlatformConfigured: false for every platform when no env vars are set (today's real state)", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(isPlatformConfigured(platform, {}), false);
  }
});

test("isPlatformConfigured: true only once BOTH the client id and secret env vars are set", () => {
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames("pinterest");
  assert.equal(isPlatformConfigured("pinterest", { [clientIdVar]: "id-only" }), false, "an id with no secret must not count as configured");
  assert.equal(isPlatformConfigured("pinterest", { [clientSecretVar]: "secret-only" }), false, "a secret with no id must not count as configured");
  assert.equal(isPlatformConfigured("pinterest", { [clientIdVar]: "id", [clientSecretVar]: "secret" }), true);
});

test("isPlatformConfigured: an unsupported platform name is never configured, regardless of env contents", () => {
  assert.equal(isPlatformConfigured("myspace", { FLORISYN_SOCIAL_MYSPACE_CLIENT_ID: "x", FLORISYN_SOCIAL_MYSPACE_CLIENT_SECRET: "y" }), false);
});

test("isPlatformConfigured: a real config check never confuses one platform's credentials for another's", () => {
  const fbVars = platformOAuthEnvVarNames("facebook");
  const env = { [fbVars.clientIdVar]: "id", [fbVars.clientSecretVar]: "secret" };
  assert.equal(isPlatformConfigured("facebook", env), true);
  assert.equal(isPlatformConfigured("instagram", env), false);
});
