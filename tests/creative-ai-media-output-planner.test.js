import test from "node:test";
import assert from "node:assert/strict";
import { planDerivedAssets, REFRAME_STRATEGIES } from "../netlify/functions/_shared/creative-ai/media-output-planner.js";
import { PLATFORM_TO_DESTINATIONS, getDestinationSpec } from "../netlify/functions/_shared/creative-ai/platform-media-specs.js";

const SUPPORTED_PLATFORMS = ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"];

test("PLATFORM_TO_DESTINATIONS: covers all 7 Marketing Studio platforms", () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.ok(PLATFORM_TO_DESTINATIONS[platform], `missing destination mapping for "${platform}"`);
  }
});

test("getDestinationSpec: rejects an unknown destination rather than returning undefined silently", () => {
  assert.throws(() => getDestinationSpec("myspace_feed"), /unknown destination/);
});

test("planDerivedAssets: a 9:16 master needs no reframe for a 9:16-only destination (TikTok)", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 45, hasBurnedInCaptions: true },
    targetPlatforms: ["tiktok"]
  });
  const tiktok = derivedAssets.find((d) => d.destination === "tiktok");
  assert.ok(tiktok);
  assert.equal(tiktok.transformations.some((t) => t.type === "reframe"), false);
});

test("planDerivedAssets: a 9:16 master DOES need a reframe for a 1:1/4:5 destination (LinkedIn)", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 45, hasBurnedInCaptions: true },
    targetPlatforms: ["linkedin"]
  });
  const linkedin = derivedAssets.find((d) => d.destination === "linkedin");
  const reframe = linkedin.transformations.find((t) => t.type === "reframe");
  assert.ok(reframe, "expected a reframe transformation");
  assert.equal(reframe.strategy, REFRAME_STRATEGIES.CENTER_CROP);
  assert.equal(reframe.from, "9:16");
});

test("planDerivedAssets: one 60-second Digital Ashley master fans out to every destination for a 7-platform campaign in one call", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 60, hasBurnedInCaptions: false },
    targetPlatforms: SUPPORTED_PLATFORMS
  });
  // instagram -> 2 destinations, youtube -> 2 destinations, the rest -> 1 each = 9 total
  assert.equal(derivedAssets.length, 9);
  const destinations = derivedAssets.map((d) => d.destination).sort();
  assert.deepEqual(destinations, [
    "facebook_feed",
    "google_business",
    "instagram_feed",
    "instagram_reels",
    "linkedin",
    "pinterest",
    "tiktok",
    "youtube_long",
    "youtube_shorts"
  ]);
});

test("planDerivedAssets: a 60s master exceeding Google Business Profile's 30s limit is flagged for human review, never auto-trimmed", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "16:9", durationSeconds: 60, hasBurnedInCaptions: true },
    targetPlatforms: ["google_business"]
  });
  const gbp = derivedAssets.find((d) => d.destination === "google_business");
  const trim = gbp.transformations.find((t) => t.type === "trim_required");
  assert.ok(trim, "expected a trim_required transformation");
  assert.equal(trim.fromSeconds, 60);
  assert.equal(trim.maxSeconds, 30);
  assert.ok(gbp.warnings.some((w) => w.includes("human review")));
  assert.equal(gbp.platformSafe, false);
});

test("planDerivedAssets: captions are requested when the master has none and the destination supports them", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 30, hasBurnedInCaptions: false },
    targetPlatforms: ["tiktok"]
  });
  const tiktok = derivedAssets.find((d) => d.destination === "tiktok");
  assert.ok(tiktok.transformations.some((t) => t.type === "add_captions"));
});

test("planDerivedAssets: no caption transformation requested when the master already has burned-in captions", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 30, hasBurnedInCaptions: true },
    targetPlatforms: ["tiktok"]
  });
  const tiktok = derivedAssets.find((d) => d.destination === "tiktok");
  assert.equal(tiktok.transformations.some((t) => t.type === "add_captions"), false);
});

test("planDerivedAssets: every video destination gets a thumbnail-generation step", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 30, hasBurnedInCaptions: true },
    targetPlatforms: ["tiktok", "linkedin"]
  });
  assert.ok(derivedAssets.every((d) => d.transformations.some((t) => t.type === "generate_thumbnail")));
});

test("planDerivedAssets: an image master never gets duration/thumbnail/caption transformations", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "image", aspectRatio: "1:1" },
    targetPlatforms: ["instagram"]
  });
  for (const d of derivedAssets) {
    assert.equal(d.transformations.some((t) => ["trim_required", "add_captions", "generate_thumbnail"].includes(t.type)), false);
  }
});

test("planDerivedAssets: an unverified-spec destination surfaces a warning rather than silently presenting the plan as fully confirmed", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 20, hasBurnedInCaptions: true },
    targetPlatforms: ["pinterest"]
  });
  const pinterest = derivedAssets.find((d) => d.destination === "pinterest");
  assert.ok(pinterest.warnings.some((w) => w.includes("unverified")));
});

test("planDerivedAssets: rejects a call with no target platforms rather than silently returning an empty plan", () => {
  assert.throws(() => planDerivedAssets({ masterAsset: { assetType: "video", aspectRatio: "9:16" }, targetPlatforms: [] }));
});

test("planDerivedAssets: an unknown platform is skipped with a warning, not a crash", () => {
  const { derivedAssets, overallWarnings } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 20 },
    targetPlatforms: ["myspace"]
  });
  assert.equal(derivedAssets.length, 0);
  assert.ok(overallWarnings.some((w) => w.includes("myspace")));
});
