import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { getProductionConfig, securityReviewSummary } from "./_shared/production.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();
  const config = getProductionConfig(process.env);
  return json(config.environment_valid ? 200 : 503, {
    ok: config.environment_valid,
    app: "Bloom Production Readiness",
    config,
    security: securityReviewSummary()
  });
}
