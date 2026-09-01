import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareMarketingImageProvider, PROVIDER_NAME } from "../netlify/functions/_shared/marketing-image-provider-cloudflare.js";
import { buildConfiguredMarketingImageProviderRegistry, selectMarketingImageProvider } from "../netlify/functions/_shared/marketing-image-providers.js";

// Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
// E/F/G: the minimum Marketing-only image-provider abstraction. Cloudflare
// is the one real, configured provider — the router is written to
// consider capability/cost/budget so a second provider is a new adapter
// later, never a routing rewrite, but nothing here pretends a second
// provider already exists.

const CONFIGURED_ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-test", CLOUDFLARE_AI_API_TOKEN: "token-test" };
const UNCONFIGURED_ENV = {};

// Part P #8: Cloudflare adapter reports configured correctly.
test("createCloudflareMarketingImageProvider: reports configured() true only with real credentials present", () => {
  assert.equal(createCloudflareMarketingImageProvider(CONFIGURED_ENV).configured(), true);
  assert.equal(createCloudflareMarketingImageProvider(UNCONFIGURED_ENV).configured(), false);
  assert.equal(createCloudflareMarketingImageProvider({ CLOUDFLARE_ACCOUNT_ID: "acct-test" }).configured(), false, "account id alone is not enough — the token is also required");
});

test("createCloudflareMarketingImageProvider: name/capabilities/estimateCost are real, fixed values — never invented per call", () => {
  const provider = createCloudflareMarketingImageProvider(CONFIGURED_ENV);
  assert.equal(provider.name, PROVIDER_NAME);
  const caps = provider.capabilities();
  assert.ok(Array.isArray(caps.aspectRatios) && caps.aspectRatios.length > 0);
  assert.deepEqual(caps.qualityTiers, ["standard"]);
  const cost = provider.estimateCost({ qualityTier: "standard" });
  assert.equal(typeof cost.cents, "number");
  assert.ok(cost.cents > 0);
  assert.equal(cost.currency, "USD");
});

test("createCloudflareMarketingImageProvider: estimateCost returns null for an unsupported quality tier, never a guessed price", () => {
  const provider = createCloudflareMarketingImageProvider(CONFIGURED_ENV);
  assert.equal(provider.estimateCost({ qualityTier: "premium" }), null);
});

// Part P #9: unconfigured provider returns an honest unavailable state.
test("buildConfiguredMarketingImageProviderRegistry: an unconfigured environment returns an empty registry, never a fabricated entry", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(UNCONFIGURED_ENV);
  assert.deepEqual(Object.keys(registry), []);
});

// Part P #10: router selects Cloudflare when eligible.
test("selectMarketingImageProvider: selects the configured Cloudflare provider for an ordinary eligible request", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(CONFIGURED_ENV);
  const selected = selectMarketingImageProvider({ aspectRatio: "1:1", qualityTier: "standard" }, registry);
  assert.equal(selected?.name, PROVIDER_NAME);
});

// Part P #11: router refuses an unsupported capability.
test("selectMarketingImageProvider: refuses a request naming an aspect ratio no registered provider supports", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(CONFIGURED_ENV);
  const selected = selectMarketingImageProvider({ aspectRatio: "21:9" }, registry);
  assert.equal(selected, null, "an unsupported aspect ratio must be honestly refused, never silently routed to a provider that can't do it");
});

test("selectMarketingImageProvider: refuses a request naming a quality tier no registered provider supports", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(CONFIGURED_ENV);
  const selected = selectMarketingImageProvider({ qualityTier: "premium" }, registry);
  assert.equal(selected, null);
});

// Part P #14: budget routing respects estimated cost.
test("selectMarketingImageProvider: refuses a provider whose estimated cost exceeds the caller's remaining budget", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(CONFIGURED_ENV);
  const cost = registry.cloudflare.estimateCost({ qualityTier: "standard" }).cents;
  assert.equal(selectMarketingImageProvider({ estimatedBudgetRemainingCents: cost - 1 }, registry), null, "a request that can't afford even the cheapest eligible provider must be refused");
  assert.equal(selectMarketingImageProvider({ estimatedBudgetRemainingCents: cost }, registry)?.name, PROVIDER_NAME, "a request that can exactly afford it must still be selected");
});

// Part P #15: an unregistered provider can never be selected.
test("selectMarketingImageProvider: a provider that was never registered (e.g. an unconfigured or hypothetical second provider) can never be selected", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(UNCONFIGURED_ENV); // nothing registered
  assert.equal(selectMarketingImageProvider({}, registry), null);
  // Also: an empty registry passed explicitly (as if a caller tried to
  // route to a provider name that was never added) still refuses cleanly.
  assert.equal(selectMarketingImageProvider({}, {}), null);
});

// Part P #16: no fake provider fallback exists — the registry only ever
// contains a provider this environment can actually, honestly reach.
test("no fake provider fallback exists: only Cloudflare is ever registered, and only when genuinely configured", () => {
  const registry = buildConfiguredMarketingImageProviderRegistry(CONFIGURED_ENV);
  assert.deepEqual(Object.keys(registry), [PROVIDER_NAME], "exactly one real, configured provider — never an invented second one");
});
