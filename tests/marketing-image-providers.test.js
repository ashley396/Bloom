import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareMarketingImageProvider, PROVIDER_NAME } from "../netlify/functions/_shared/marketing-image-provider-cloudflare.js";
import {
  createOpenAiMarketingImageProvider,
  openAiImageGenerationConfigured,
  PROVIDER_NAME as OPENAI_PROVIDER_NAME
} from "../netlify/functions/_shared/marketing-image-provider-openai.js";
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

// ============================================================================
// Hybrid Marketing Studio, Batch 1, Part 4/6/12/13 — OpenAI GPT-Image-2
// adapter. All tests below use a FAKE key ("sk-test-not-real") and never
// call generate()/edit() against the real network — no live OpenAI call is
// ever made in this suite (Part 13's own explicit instruction).
// ============================================================================

const OPENAI_CONFIGURED_ENV = { OPENAI_API_KEY: "sk-test-not-real" };
const OPENAI_UNCONFIGURED_ENV = {};

// Required test #1: provider absent when unconfigured.
test("Batch1 #1 provider-absent: openAiImageGenerationConfigured() is false with no key, and the registry never registers it", () => {
  assert.equal(openAiImageGenerationConfigured(OPENAI_UNCONFIGURED_ENV), false);
  const registry = buildConfiguredMarketingImageProviderRegistry(OPENAI_UNCONFIGURED_ENV);
  assert.deepEqual(Object.keys(registry), [], "no OPENAI_API_KEY means no OpenAI entry — never a fabricated one");
});

// Required test #2: provider configured when a real-shaped key is present.
test("Batch1 #2 provider-configured: openAiImageGenerationConfigured() is true with a key present, and the registry registers it", () => {
  assert.equal(openAiImageGenerationConfigured(OPENAI_CONFIGURED_ENV), true);
  const registry = buildConfiguredMarketingImageProviderRegistry(OPENAI_CONFIGURED_ENV);
  assert.ok(Object.keys(registry).includes(OPENAI_PROVIDER_NAME));
});

// Required test #3: the key itself is never leaked back out of the
// provider object (no getter/property exposes it), and — separately — no
// public/*.js source file references OPENAI_API_KEY at all (Part 4:
// "OPENAI_API_KEY must NEVER appear in public/*.js").
test("Batch1 #3 no-key-leak-to-client: the provider object never exposes the raw API key, and no public/*.js file references OPENAI_API_KEY", async () => {
  const provider = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  const serialized = JSON.stringify(Object.keys(provider).map((k) => [k, String(provider[k])]));
  assert.ok(!serialized.includes("sk-test-not-real"), "the provider's own enumerable shape must never contain the raw key");

  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const publicDir = path.resolve(process.cwd(), "public");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (entry.endsWith(".js") && readFileSync(full, "utf8").includes("OPENAI_API_KEY")) offenders.push(full);
    }
  };
  walk(publicDir);
  assert.deepEqual(offenders, [], "OPENAI_API_KEY must never appear in any public/*.js file — server-side only");
});

// Required test #4: interface match — same 5-method shape as Cloudflare.
test("Batch1 #4 interface-match: the OpenAI adapter exposes the exact same registry interface as the Cloudflare adapter", () => {
  const openai = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  const cloudflare = createCloudflareMarketingImageProvider({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_AI_API_TOKEN: "t" });
  for (const method of ["name", "configured", "capabilities", "estimateCost", "generate"]) {
    assert.ok(method in openai, `OpenAI adapter is missing required interface member "${method}"`);
    assert.equal(typeof openai[method], typeof cloudflare[method], `"${method}" must be the same kind of member (function vs value) on both adapters`);
  }
  assert.equal(openai.name, OPENAI_PROVIDER_NAME);
});

// Required test #5: cost estimation is a conservative, named reservation —
// never Claude's report's $0.053/image treated as authoritative, and
// always carries cost_source so a reservation can be told apart from a
// reconciled figure (Part 6).
test("Batch1 #5 cost-reservation-before-call: estimateCost() returns a conservative per-tier ceiling with cost_source metadata, never a bare unlabeled number", () => {
  const provider = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  for (const tier of ["low", "medium", "high"]) {
    const cost = provider.estimateCost({ qualityTier: tier });
    assert.equal(typeof cost.cents, "number");
    assert.ok(cost.cents > 0);
    assert.equal(cost.cost_source, "openai_conservative_ceiling_estimate");
  }
  // Ceiling must actually increase with tier — a "conservative upper bound"
  // that didn't scale with requested quality would be dishonest.
  const low = provider.estimateCost({ qualityTier: "low" }).cents;
  const medium = provider.estimateCost({ qualityTier: "medium" }).cents;
  const high = provider.estimateCost({ qualityTier: "high" }).cents;
  assert.ok(low < medium && medium < high, "cost ceiling must increase from low to medium to high");
});

test("Batch1 estimateCost returns null for an unsupported quality tier, never a guessed price", () => {
  const provider = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  assert.equal(provider.estimateCost({ qualityTier: "ultra" }), null);
});

// Required test #6: a failed call reports ok:false and never throws — the
// caller's own reserveProviderCall/failProviderCall reconciliation depends
// on generate() always resolving, never rejecting.
test("Batch1 #6 failed-call-reconciliation: generate() reports ok:false (never throws) when unconfigured, given a bad prompt, or given an unsupported aspect ratio/tier", async () => {
  const unconfigured = createOpenAiMarketingImageProvider(OPENAI_UNCONFIGURED_ENV);
  const resA = await unconfigured.generate({ client: {}, shopId: "shop-1", prompt: "spring bouquet flyer" });
  assert.equal(resA.ok, false);
  assert.equal(resA.stage, "config");

  const configured = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  const resB = await configured.generate({ client: {}, shopId: "shop-1", prompt: "" });
  assert.equal(resB.ok, false);
  assert.equal(resB.stage, "config");

  const resC = await configured.generate({ client: {}, shopId: "shop-1", prompt: "spring bouquet flyer", aspectRatio: "21:9" });
  assert.equal(resC.ok, false, "an aspect ratio GPT-Image-2 doesn't support must fail closed, never silently pick a default");

  const resD = await configured.generate({ client: {}, shopId: "shop-1", prompt: "spring bouquet flyer", qualityTier: "ultra" });
  assert.equal(resD.ok, false, "an unsupported quality tier must fail closed");
});

// Required test #7: real reported usage reconciles to an actual cost;
// absent usage never fabricates one.
test("Batch1 #7 actual-usage-reconciliation: real OpenAI usage tokens reconcile to a real cost figure with the reconciled cost_source, and are never fabricated when absent", async () => {
  const { estimateOpenAiActualCostCentsFromUsage } = await import("../netlify/functions/_shared/marketing-cost-config.js");
  const reconciled = estimateOpenAiActualCostCentsFromUsage({ input_tokens: 100000, output_tokens: 200000 });
  assert.equal(typeof reconciled.cents, "number");
  assert.ok(reconciled.cents > 0);
  assert.equal(reconciled.cost_source, "openai_reconciled_from_usage");
  assert.equal(estimateOpenAiActualCostCentsFromUsage(null), null, "no usage reported means no fabricated reconciled figure — null, not a guess");
  assert.equal(estimateOpenAiActualCostCentsFromUsage({}), null);
});

// Required test #22 (existing-provider-registry-tests-remain-green):
// registering OpenAI must never change what the EXISTING live call site
// (marketing-image-quality.js, which requests the default "standard"
// quality tier) actually selects — Cloudflare must still be the only
// provider chosen even when OpenAI is also configured, since OpenAI's own
// capabilities never include "standard" (Part 12: no live routing change).
test("Batch1 registering OpenAI never changes the existing default-tier selection: an unqualified ('standard') request still selects Cloudflare even when OpenAI is also configured", () => {
  const bothConfiguredEnv = { ...CONFIGURED_ENV, ...OPENAI_CONFIGURED_ENV };
  const registry = buildConfiguredMarketingImageProviderRegistry(bothConfiguredEnv);
  assert.ok(Object.keys(registry).includes(PROVIDER_NAME));
  assert.ok(Object.keys(registry).includes(OPENAI_PROVIDER_NAME));
  const selected = selectMarketingImageProvider({}, registry); // mirrors marketing-image-quality.js's own call exactly
  assert.equal(selected?.name, PROVIDER_NAME, "the existing live call site's default request must still resolve to Cloudflare, never OpenAI, until a future explicit activation change");
});

test("Batch1 OpenAI capabilities are real and narrow — only the three sizes GPT-Image-2 actually supports, never inherited/copied from Cloudflare's own aspect ratios", () => {
  const provider = createOpenAiMarketingImageProvider(OPENAI_CONFIGURED_ENV);
  const caps = provider.capabilities();
  assert.deepEqual([...caps.aspectRatios].sort(), ["1:1", "2:3", "3:2"]);
  assert.deepEqual([...caps.qualityTiers].sort(), ["high", "low", "medium"]);
});
