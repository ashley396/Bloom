/** Bloom 1.0 release candidate metadata (shared server/client). */

export const BLOOM_VERSION_LABEL = "Bloom Version 1.0 RC1";
export const BLOOM_VERSION_CODE = "1.0.0-rc.1";
export const BLOOM_SCHEMA_TAG = "release-candidate-v1";

/** Forward-only migrations for this line (review before apply). */
export const MIGRATION_MANIFEST = [
  { id: "verification", file: "20260727_marketplace_verification_production_v1.sql", probe: "marketplace_verification_applications" },
  { id: "marketplace_v2", file: "20260728_marketplace_milestone_v2.sql", probe: "marketplace_listings" },
  { id: "wholesale", file: "20260728_wholesale_seller_v1.sql", probe: "marketplace_listing_variants" },
  { id: "command_center", file: "20260728_command_center_v1.sql", probe: "platform_feature_flags" },
  { id: "lily", file: "20260728_lily_ai_platform_v1.sql", probe: "lily_conversations" },
  { id: "beta_feedback", file: "20260728_release_candidate_v1.sql", probe: "platform_beta_feedback" }
];

export const KNOWN_ISSUES_V1 = [
  {
    id: "university",
    severity: "info",
    title: "Bloom University not in POS navigation",
    detail: "Feature flag exists; dedicated University module is post–1.0 GA."
  },
  {
    id: "pagination",
    severity: "low",
    title: "Large order lists load in full",
    detail: "Shops with very high volume should filter by date until pagination ships."
  },
  {
    id: "rate-limit",
    severity: "low",
    title: "Auth rate limits are per-function instance",
    detail: "Global edge rate limiting recommended before wide public launch."
  },
  {
    id: "mobile-more",
    severity: "low",
    title: "Mobile “More” menu uses text prompt",
    detail: "Use sidebar pages on tablet/desktop for full navigation."
  }
];

export async function probeMigrationStatus(client) {
  const results = [];
  for (const row of MIGRATION_MANIFEST) {
    let status = "unknown";
    try {
      const { error } = await client.from(row.probe).select("id", { head: true, count: "exact" }).limit(1);
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        status = msg.includes("does not exist") || msg.includes("could not find") ? "missing" : "error";
      } else {
        status = "applied";
      }
    } catch {
      status = "missing";
    }
    results.push({ ...row, status });
  }
  return results;
}
