/** Validators for Marketing Campaigns — the connective layer over Email
 * Campaigns, Holiday Command Center, and future social/text/promotion
 * content, so a florist plans one campaign instead of juggling disconnected
 * tools. Same trim/parse discipline as holiday-weddings-email.js.
 */

function trimStr(value, max) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function parseDate(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; // invalid, distinct from "not provided"
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return s;
}

function parseUuid(value) {
  const s = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s.toLowerCase();
}

export const CAMPAIGN_STATUSES = Object.freeze([
  "draft",
  "ready",
  "scheduled",
  "active",
  "completed",
  "paused",
]);

/** Channels a campaign can be tagged with — only channels Florisyn actually
 * has real backend support for today. Adding a new real integration means
 * adding it here, never displaying a channel Florisyn can't act on. */
export const CAMPAIGN_CHANNELS = Object.freeze(["email", "holiday", "website", "social", "text"]);

export function validateMarketingCampaignBody(body = {}, { partial = false } = {}) {
  const name = trimStr(body.name, 120);
  const goal = trimStr(body.goal, 200) || null;
  const status = trimStr(body.status || "draft", 32).toLowerCase();
  const audience_note = trimStr(body.audience_note, 500) || null;
  const notes = trimStr(body.notes, 4000) || null;

  if (!partial && !name) return { valid: false, error: "Campaign name is required." };
  if (body.name !== undefined && !name) return { valid: false, error: "Campaign name is required." };
  if (body.status !== undefined && !CAMPAIGN_STATUSES.includes(status)) {
    return { valid: false, error: "Invalid campaign status." };
  }

  const starts_on = body.starts_on === undefined ? undefined : parseDate(body.starts_on);
  const ends_on = body.ends_on === undefined ? undefined : parseDate(body.ends_on);
  if (starts_on === undefined && body.starts_on !== undefined) {
    return { valid: false, error: "Invalid start date." };
  }
  if (ends_on === undefined && body.ends_on !== undefined) {
    return { valid: false, error: "Invalid end date." };
  }
  if (starts_on && ends_on && ends_on < starts_on) {
    return { valid: false, error: "End date must be on or after start date." };
  }

  let product_ids;
  if (body.product_ids !== undefined) {
    const list = Array.isArray(body.product_ids) ? body.product_ids : [];
    const parsed = list.map((id) => parseUuid(id)).filter(Boolean);
    if (parsed.length !== list.length) return { valid: false, error: "Invalid product id in product_ids." };
    product_ids = parsed.slice(0, 100);
  }

  let channels;
  if (body.channels !== undefined) {
    const list = Array.isArray(body.channels) ? body.channels : [];
    const lowered = list.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean);
    if (!lowered.every((c) => CAMPAIGN_CHANNELS.includes(c))) {
      return { valid: false, error: "Invalid channel in channels." };
    }
    channels = [...new Set(lowered)];
  }

  const sanitized = {};
  if (body.name !== undefined || !partial) sanitized.name = name;
  if (body.goal !== undefined || !partial) sanitized.goal = goal;
  if (body.status !== undefined || !partial) sanitized.status = status || "draft";
  if (body.starts_on !== undefined) sanitized.starts_on = starts_on;
  if (body.ends_on !== undefined) sanitized.ends_on = ends_on;
  if (body.audience_note !== undefined || !partial) sanitized.audience_note = audience_note;
  if (body.notes !== undefined || !partial) sanitized.notes = notes;
  if (product_ids !== undefined) sanitized.product_ids = product_ids;
  if (channels !== undefined) sanitized.channels = channels;

  return { valid: true, sanitized };
}
