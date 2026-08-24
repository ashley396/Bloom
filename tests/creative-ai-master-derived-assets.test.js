import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  planDerivedAssets,
  toAssetTransformationType,
  PLANNER_TO_ASSET_TRANSFORMATION_TYPE
} from "../netlify/functions/_shared/creative-ai/media-output-planner.js";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260824000000_creative_ai_webhook_disclosure_media.sql"),
    "utf8"
  );
}

// ── Schema-level invariant ─────────────────────────────────────────────

test("migration: a transformation_type always implies parent_asset_id (one-directional) — a transform can never be orphaned", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /add constraint ai_generated_assets_master_derived_consistency check \(\s*transformation_type is null or parent_asset_id is not null\s*\)/,
    "the consistency check must be one-directional: transformation_type -> parent_asset_id required, not the reverse"
  );
});

test("migration: does NOT require the reverse — a bare parent_asset_id with no transformation_type must stay valid", () => {
  const sql = migrationSql();
  // The old, incorrect two-directional form would have looked like this;
  // guard against ever reintroducing it.
  assert.doesNotMatch(
    sql,
    /parent_asset_id is null and transformation_type is null/,
    "must not resurrect the two-directional constraint that breaks Lily's pre-existing revision-chain rows"
  );
});

test("migration: preserves Lily's existing parent_asset_id semantics — does not narrow its on-delete behavior", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /add column if not exists parent_asset_id uuid references public\.ai_generated_assets\(id\) on delete set null/,
    "parent_asset_id already existed (Lily Visual Creation Studio, on delete set null) — this migration must add it idempotently with the SAME on-delete behavior, never redefine it to cascade"
  );
});

test("migration: transformation_type is a real, closed vocabulary matching what the planner can actually produce", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /transformation_type in \('reframe', 'transcode', 'caption_burn', 'thumbnail', 'trim'\)/
  );
});

test("migration: asset_type rebuild is a strict superset — never drops a type an existing feature relies on (background, flyer from Lily)", () => {
  const sql = migrationSql();
  assert.match(sql, /asset_type in \('social_post', 'image', 'video_concept', 'website_section', 'background', 'flyer', 'video', 'voice'\)/);
});

// ── Planner-to-schema vocabulary mapping ────────────────────────────────

test("toAssetTransformationType: every planner transformation type this pass can emit maps onto a real DB-enum value or an explicit null", () => {
  const sql = migrationSql();
  const dbEnumMatch = sql.match(/transformation_type in \(([^)]+)\)/);
  const dbEnum = dbEnumMatch[1].split(",").map((s) => s.trim().replace(/'/g, ""));

  for (const [plannerType, assetType] of Object.entries(PLANNER_TO_ASSET_TRANSFORMATION_TYPE)) {
    if (assetType === null) continue; // deliberately unmapped (e.g. trim_required — no execution exists)
    assert.ok(dbEnum.includes(assetType), `planner type "${plannerType}" maps to "${assetType}", which is not in the DB's transformation_type enum`);
  }
});

test("toAssetTransformationType: reframe, add_captions, generate_thumbnail all map to real storable transformation types", () => {
  assert.equal(toAssetTransformationType("reframe"), "reframe");
  assert.equal(toAssetTransformationType("add_captions"), "caption_burn");
  assert.equal(toAssetTransformationType("generate_thumbnail"), "thumbnail");
});

test("toAssetTransformationType: trim_required maps to null — the planner never auto-trims, so no derived asset row should ever be created for it", () => {
  assert.equal(toAssetTransformationType("trim_required"), null);
});

test("toAssetTransformationType: rejects an unknown planner type rather than silently returning undefined", () => {
  assert.throws(() => toAssetTransformationType("not_a_real_type"), /unknown planner transformation type/);
});

// ── End-to-end: every transformation a real plan produces is persistable ─

test("planDerivedAssets: every transformation in a realistic multi-platform video plan resolves to a valid (or deliberately-null) DB transformation_type", () => {
  const { derivedAssets } = planDerivedAssets({
    masterAsset: { assetType: "video", aspectRatio: "9:16", durationSeconds: 45, hasBurnedInCaptions: false },
    targetPlatforms: ["instagram", "tiktok", "youtube", "linkedin"]
  });

  assert.ok(derivedAssets.length > 0);
  for (const derived of derivedAssets) {
    for (const transformation of derived.transformations) {
      // Must not throw — every type the planner can actually emit is a
      // recognized entry in the mapping table.
      const mapped = toAssetTransformationType(transformation.type);
      if (transformation.type === "trim_required") {
        assert.equal(mapped, null);
      } else {
        assert.equal(typeof mapped, "string", `"${transformation.type}" on destination "${derived.destination}" should map to a storable transformation_type`);
      }
    }
  }
});

test("planDerivedAssets: a master reused across every platform is always the SAME logical master — the plan never re-derives from a derived asset (no chained transformation)", () => {
  const masterAsset = { assetType: "video", aspectRatio: "16:9", durationSeconds: 55, hasBurnedInCaptions: false };
  const { derivedAssets } = planDerivedAssets({
    masterAsset,
    targetPlatforms: ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"]
  });
  // Every derived entry's transformations are computed straight from the
  // single master's own properties (aspectRatio/durationSeconds/captions),
  // never from another derived entry in the same result — i.e. this is a
  // one-hop star (master -> many derived), never a chain.
  for (const derived of derivedAssets) {
    for (const t of derived.transformations) {
      if (t.type === "reframe") {
        assert.equal(t.from, masterAsset.aspectRatio, "every reframe must originate from the master's own aspect ratio, not a previously-derived one");
      }
    }
  }
});
