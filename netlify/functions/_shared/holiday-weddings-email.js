/**
 * Validators + helpers for Holiday Command Center, Email Campaigns, Wedding Workflows.
 * Additive modules — feature-flagged default OFF.
 */

function trimStr(value, max) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function parseDate(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function parseIntNonNeg(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseUuid(value) {
  const s = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s.toLowerCase();
}

export const HOLIDAY_STATUSES = Object.freeze(["planning", "active", "paused", "archived"]);
export const EMAIL_STATUSES = Object.freeze(["draft", "scheduled", "sent", "cancelled"]);
export const WEDDING_STATUSES = Object.freeze([
  "inquiry",
  "proposal",
  "booked",
  "in_production",
  "delivered",
  "closed",
]);

export function validateHolidayPeakBody(body = {}, { partial = false } = {}) {
  const name = trimStr(body.name, 120);
  const starts_on = parseDate(body.starts_on);
  const ends_on = parseDate(body.ends_on);
  const status = trimStr(body.status || "planning", 32).toLowerCase();
  const staff_notes = trimStr(body.staff_notes, 2000) || null;
  const target_orders = parseIntNonNeg(body.target_orders, 0);
  const current_orders = parseIntNonNeg(body.current_orders, 0);
  const alert_threshold = parseIntNonNeg(body.alert_threshold, 80);
  const is_paused = body.is_paused === undefined ? undefined : Boolean(body.is_paused);

  if (!partial) {
    if (!name) return { valid: false, error: "Holiday name is required." };
    if (!starts_on || !ends_on) return { valid: false, error: "Start and end dates are required." };
    if (ends_on < starts_on) return { valid: false, error: "End date must be on or after start date." };
  } else if (body.name !== undefined && !name) {
    return { valid: false, error: "Holiday name is required." };
  }

  if (body.status !== undefined && !HOLIDAY_STATUSES.includes(status)) {
    return { valid: false, error: "Invalid holiday status." };
  }
  if (target_orders === null || current_orders === null) {
    return { valid: false, error: "Order counts must be non-negative numbers." };
  }
  if (alert_threshold === null || alert_threshold > 100) {
    return { valid: false, error: "Alert threshold must be between 0 and 100." };
  }
  if (body.starts_on !== undefined && !starts_on) {
    return { valid: false, error: "Invalid start date." };
  }
  if (body.ends_on !== undefined && !ends_on) {
    return { valid: false, error: "Invalid end date." };
  }
  if (starts_on && ends_on && ends_on < starts_on) {
    return { valid: false, error: "End date must be on or after start date." };
  }

  const sanitized = {};
  if (body.name !== undefined || !partial) sanitized.name = name;
  if (body.starts_on !== undefined || !partial) sanitized.starts_on = starts_on;
  if (body.ends_on !== undefined || !partial) sanitized.ends_on = ends_on;
  if (body.status !== undefined || !partial) sanitized.status = status || "planning";
  if (body.staff_notes !== undefined || !partial) sanitized.staff_notes = staff_notes;
  if (body.target_orders !== undefined || !partial) sanitized.target_orders = target_orders;
  if (body.current_orders !== undefined || !partial) sanitized.current_orders = current_orders;
  if (body.alert_threshold !== undefined || !partial) sanitized.alert_threshold = alert_threshold;
  if (is_paused !== undefined) {
    sanitized.is_paused = is_paused;
    if (is_paused) sanitized.status = "paused";
  }

  return { valid: true, sanitized };
}

export function holidayCapacityAlert(peak) {
  const target = Number(peak?.target_orders) || 0;
  const current = Number(peak?.current_orders) || 0;
  const threshold = Number(peak?.alert_threshold) || 80;
  if (target <= 0) {
    return { level: "none", pct: 0, message: "Set a capacity target to track peak load." };
  }
  const pct = Math.round((current / target) * 100);
  if (peak?.is_paused || peak?.status === "paused") {
    return { level: "paused", pct, message: "Orders paused for this peak." };
  }
  if (pct >= 100) {
    return { level: "critical", pct, message: "At or over peak capacity." };
  }
  if (pct >= threshold) {
    return { level: "warn", pct, message: `Approaching capacity (${pct}% of target).` };
  }
  return { level: "ok", pct, message: `${pct}% of capacity target.` };
}

export function validateEmailCampaignBody(body = {}, { partial = false } = {}) {
  const name = trimStr(body.name, 120);
  const subject = trimStr(body.subject, 200);
  const preview_text = trimStr(body.preview_text, 240) || null;
  const body_html = trimStr(body.body_html, 20000);
  const audience_note = trimStr(body.audience_note, 500) || null;
  const status = trimStr(body.status || "draft", 32).toLowerCase();
  let scheduled_at = null;
  if (body.scheduled_at !== undefined && body.scheduled_at !== null && body.scheduled_at !== "") {
    const t = Date.parse(String(body.scheduled_at));
    if (Number.isNaN(t)) return { valid: false, error: "Invalid scheduled time." };
    scheduled_at = new Date(t).toISOString();
  }

  if (!partial) {
    if (!name) return { valid: false, error: "Campaign name is required." };
    if (!subject) return { valid: false, error: "Subject is required." };
  } else {
    if (body.name !== undefined && !name) return { valid: false, error: "Campaign name is required." };
    if (body.subject !== undefined && !subject) return { valid: false, error: "Subject is required." };
  }

  if (body.status !== undefined && !EMAIL_STATUSES.includes(status)) {
    return { valid: false, error: "Invalid campaign status." };
  }

  const sanitized = {};
  if (body.name !== undefined || !partial) sanitized.name = name;
  if (body.subject !== undefined || !partial) sanitized.subject = subject;
  if (body.preview_text !== undefined || !partial) sanitized.preview_text = preview_text;
  if (body.body_html !== undefined || !partial) sanitized.body_html = body_html || "";
  if (body.audience_note !== undefined || !partial) sanitized.audience_note = audience_note;
  if (body.status !== undefined || !partial) sanitized.status = status || "draft";
  if (body.scheduled_at !== undefined) sanitized.scheduled_at = scheduled_at;

  return { valid: true, sanitized };
}

export function validateWeddingProjectBody(body = {}, { partial = false } = {}) {
  const couple_names = trimStr(body.couple_names, 160);
  const venue = trimStr(body.venue, 200) || null;
  const notes = trimStr(body.notes, 4000) || null;
  const status = trimStr(body.status || "inquiry", 32).toLowerCase();
  const event_date =
    body.event_date === undefined || body.event_date === null || body.event_date === ""
      ? null
      : parseDate(body.event_date);
  const budget_cents = parseIntNonNeg(body.budget_cents, 0);
  const customer_id =
    body.customer_id === undefined || body.customer_id === null || body.customer_id === ""
      ? null
      : parseUuid(body.customer_id);
  const order_id =
    body.order_id === undefined || body.order_id === null || body.order_id === ""
      ? null
      : parseUuid(body.order_id);

  if (!partial && !couple_names) {
    return { valid: false, error: "Couple names are required." };
  }
  if (body.couple_names !== undefined && !couple_names) {
    return { valid: false, error: "Couple names are required." };
  }
  if (body.event_date !== undefined && body.event_date !== null && body.event_date !== "" && !event_date) {
    return { valid: false, error: "Invalid event date." };
  }
  if (body.status !== undefined && !WEDDING_STATUSES.includes(status)) {
    return { valid: false, error: "Invalid wedding status." };
  }
  if (budget_cents === null) {
    return { valid: false, error: "Budget must be a non-negative number of cents." };
  }
  if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== "" && !customer_id) {
    return { valid: false, error: "Invalid customer id." };
  }
  if (body.order_id !== undefined && body.order_id !== null && body.order_id !== "" && !order_id) {
    return { valid: false, error: "Invalid order id." };
  }

  const sanitized = {};
  if (body.couple_names !== undefined || !partial) sanitized.couple_names = couple_names;
  if (body.event_date !== undefined || !partial) sanitized.event_date = event_date;
  if (body.venue !== undefined || !partial) sanitized.venue = venue;
  if (body.notes !== undefined || !partial) sanitized.notes = notes;
  if (body.status !== undefined || !partial) sanitized.status = status || "inquiry";
  if (body.budget_cents !== undefined || !partial) sanitized.budget_cents = budget_cents;
  if (body.customer_id !== undefined) sanitized.customer_id = customer_id;
  if (body.order_id !== undefined) sanitized.order_id = order_id;

  return { valid: true, sanitized };
}

export function validateWeddingChecklistBody(body = {}) {
  const title = trimStr(body.title, 200);
  if (!title) return { valid: false, error: "Checklist item title is required." };
  const sort_order = parseIntNonNeg(body.sort_order, 0);
  if (sort_order === null) return { valid: false, error: "Invalid sort order." };
  return {
    valid: true,
    sanitized: {
      title,
      is_done: Boolean(body.is_done),
      sort_order,
    },
  };
}
