/** AI Suite action names and response shapes (shared by API, tests, clients). */

export const AI_SUITE_ACTIONS = [
  "marketing_segment",
  "marketing_strategy",
  "marketing_campaign_draft",
  "photo_analyze",
  "photo_suggest_corrections",
  "photo_social_presets",
  "photo_auto_enhance",
  "pos_realtime_kpis",
  "pos_inventory_alerts",
  "pos_sales_insights",
  "suite_status"
];

export const MARKETING_CHANNELS = ["email", "instagram", "facebook", "sms", "google_business", "holiday_campaign"];

export function validateAiSuiteRequest(body = {}) {
  const action = String(body.action || "").toLowerCase();
  if (!action) return { valid: false, error: "action required", code: "missing_action" };
  if (!AI_SUITE_ACTIONS.includes(action)) {
    return { valid: false, error: `Unknown action: ${action}`, code: "invalid_action" };
  }
  return { valid: true, action };
}
