import test from "node:test";
import assert from "node:assert/strict";
import { planPersonalBrandPlatformVariants, resolveTargetPlatforms } from "../netlify/functions/_shared/creative-ai/personal-brand-platform-variants.js";

test("planPersonalBrandPlatformVariants: instagram expands to both feed and Reels destinations, tagged with the right content kind", () => {
  const plan = planPersonalBrandPlatformVariants({ mode: "founder_portrait", targetPlatforms: ["instagram"] });
  assert.equal(plan.length, 1);
  const destinations = plan[0].destinations.map((d) => d.destination);
  assert.deepEqual(destinations.sort(), ["instagram_feed", "instagram_reels"].sort());
  const reels = plan[0].destinations.find((d) => d.destination === "instagram_reels");
  assert.equal(reels.contentKind, "video");
  const feed = plan[0].destinations.find((d) => d.destination === "instagram_feed");
  assert.equal(feed.contentKind, "image");
});

test("planPersonalBrandPlatformVariants: youtube expands to long-form and Shorts, both video", () => {
  const plan = planPersonalBrandPlatformVariants({ mode: "educational", targetPlatforms: ["youtube"] });
  const kinds = plan[0].destinations.map((d) => d.contentKind);
  assert.ok(kinds.every((k) => k === "video"));
});

test("planPersonalBrandPlatformVariants: google_business gets its own image-only destination, never a Reel-style video slot", () => {
  const plan = planPersonalBrandPlatformVariants({ mode: "product_shop_promotion", targetPlatforms: ["google_business"] });
  assert.equal(plan[0].destinations.length, 1);
  assert.equal(plan[0].destinations[0].contentKind, "image");
});

test("planPersonalBrandPlatformVariants: throws on an unknown platform rather than silently dropping it", () => {
  assert.throws(() => planPersonalBrandPlatformVariants({ mode: "casual", targetPlatforms: ["myspace"] }), /unknown platform/);
});

test("planPersonalBrandPlatformVariants: throws on an unknown mode", () => {
  assert.throws(() => planPersonalBrandPlatformVariants({ mode: "not_a_mode", targetPlatforms: ["facebook"] }), /unknown mode/);
});

test("planPersonalBrandPlatformVariants: requires at least one target platform", () => {
  assert.throws(() => planPersonalBrandPlatformVariants({ mode: "casual", targetPlatforms: [] }), /at least one/);
});

test("resolveTargetPlatforms: an explicit platform from Lily's classifier always wins", () => {
  assert.deepEqual(resolveTargetPlatforms({ mode: "casual", explicitPlatform: "tiktok", requestedPlatforms: ["facebook"] }), ["tiktok"]);
});

test("resolveTargetPlatforms: falls back to the mode's own suggested platforms with no explicit request", () => {
  const result = resolveTargetPlatforms({ mode: "founder_portrait" });
  assert.deepEqual(result, ["linkedin", "facebook", "instagram"]);
});

test("resolveTargetPlatforms: a caller-supplied platform list is honored over the mode default", () => {
  const result = resolveTargetPlatforms({ mode: "founder_portrait", requestedPlatforms: ["pinterest"] });
  assert.deepEqual(result, ["pinterest"]);
});
