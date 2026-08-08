/**
 * Inventory freshness / use-first helpers (Foundation migration fields).
 */

export function parseInventoryDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: "Dates must use YYYY-MM-DD format." };
  const parsed = new Date(`${text}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return { error: "Enter a valid date." };
  return { value: text };
}

export function validateMarkupMultiplier(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required
      ? { ok: false, error: "Markup multiplier is required." }
      : { ok: true, value: 3.0 };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.1 || n > 50) {
    return { ok: false, error: "Markup must be between 0.1× and 50×." };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateInventoryFreshnessFields(body = {}) {
  const errors = [];
  let received_at = null;
  let use_by = null;

  if ("received_at" in body && body.received_at) {
    const parsed = parseInventoryDate(body.received_at);
    if (parsed?.error) errors.push(`Received date: ${parsed.error}`);
    else received_at = parsed.value;
  } else if (body.arrival_date) {
    const parsed = parseInventoryDate(body.arrival_date);
    if (parsed?.error) errors.push(`Arrival date: ${parsed.error}`);
    else received_at = parsed.value;
  }

  if ("use_by" in body && body.use_by) {
    const parsed = parseInventoryDate(body.use_by);
    if (parsed?.error) errors.push(`Use-first date: ${parsed.error}`);
    else use_by = parsed.value;
  }

  if (received_at && use_by && use_by < received_at) {
    errors.push("Use-first date cannot be before received date.");
  }

  const markup = validateMarkupMultiplier(body.markup_multiplier);
  if (!markup.ok) errors.push(markup.error);

  /* Precedence bug fix: never coerce a provided item_kind via `||` with ternary. */
  const ALLOWED_KINDS = new Set(["flower", "supply", "container", "ribbon", "foam", "other"]);
  const rawKind = String(body.item_kind ?? "").trim().toLowerCase();
  let item_kind;
  if (rawKind) {
    item_kind = (ALLOWED_KINDS.has(rawKind) ? rawKind : rawKind.replace(/[^a-z0-9_\-]/g, "").slice(0, 40)) || "other";
  } else {
    const category = String(body.category || "").trim().toLowerCase();
    item_kind = category === "flowers" || category === "flower" ? "flower" : "supply";
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      received_at,
      use_by,
      markup_multiplier: markup.ok ? markup.value : 3.0,
      item_kind,
    },
  };
}

export function inventoryFreshnessBucket(item, freshnessFn) {
  const f = freshnessFn ? freshnessFn(item) : defaultFreshnessScore(item);
  if (Number(item.quantity || 0) <= 0) return "archived";
  if (f.useFirst || f.score <= 25) return "use_first";
  if (f.expiringSoon || f.score <= 55) return "expiring_soon";
  return "fresh";
}

function defaultFreshnessScore(item) {
  const received = item.received_at || item.arrival_date;
  if (!received) return { score: 100, useFirst: false, expiringSoon: false };
  const age = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${received}T12:00:00`).getTime()) / 86400000,
    ),
  );
  const life = Math.max(1, Number(item.vase_life_days || 7));
  const score = Math.max(0, Math.round((1 - age / life) * 100));
  const useBy = item.use_by ? new Date(`${item.use_by}T12:00:00`) : null;
  const daysToUseBy = useBy
    ? Math.ceil((useBy.getTime() - Date.now()) / 86400000)
    : null;
  return {
    score,
    useFirst: score <= 25 || (daysToUseBy !== null && daysToUseBy <= 1),
    expiringSoon: score <= 55 || (daysToUseBy !== null && daysToUseBy <= 3),
  };
}
