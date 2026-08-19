import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { getProductionConfig, securityReviewSummary } from "./_shared/production.js";
import { getAiProviderStatus } from "./_shared/ai-status.js";
import { getFeatureFlags } from "./_shared/feature-flags.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();
  const config = getProductionConfig(process.env);
  return json(config.environment_valid ? 200 : 503, {
    ok: config.environment_valid,
    app: "Florisyn Production Readiness",
    config,
    ai: getAiProviderStatus(process.env),
    feature_flags: getFeatureFlags(process.env),
    security: securityReviewSummary()
  });
}
