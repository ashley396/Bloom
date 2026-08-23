/**
 * Marketing Command Center — unified calendar.
 *
 * A pure aggregator: takes the campaigns, promotions, and holiday peaks a
 * shop already has (each from its own real, already-built module — no new
 * data source) and produces one sorted list of dated events. This is
 * read-only scheduling visibility, not a second source of truth for any
 * of those records.
 */

function pushEvent(events, { date, type, label, sublabel, edge }) {
  if (!date) return;
  events.push({ date, type, label, sublabel: sublabel || null, edge });
}

/**
 * @param {object} params
 * @param {Array} params.campaigns - marketing_campaigns rows (id, name, status, starts_on, ends_on)
 * @param {Array} params.promotions - marketing_promotions rows (id, name, status, starts_on, ends_on)
 * @param {Array} params.holidayPeaks - holiday_peaks rows (id, name, starts_on, ends_on)
 * @returns {Array<{date:string, type:string, label:string, sublabel:string|null, edge:string}>}
 *   sorted ascending by date, then type, then label
 */
export function buildCalendarEvents({ campaigns = [], promotions = [], holidayPeaks = [] } = {}) {
  const events = [];

  for (const c of campaigns) {
    if (c.starts_on && c.starts_on === c.ends_on) {
      pushEvent(events, { date: c.starts_on, type: "campaign", label: c.name, sublabel: c.status, edge: "single" });
      continue;
    }
    pushEvent(events, { date: c.starts_on, type: "campaign", label: c.name, sublabel: c.status, edge: "start" });
    pushEvent(events, { date: c.ends_on, type: "campaign", label: c.name, sublabel: c.status, edge: "end" });
  }

  for (const p of promotions) {
    if (p.starts_on && p.starts_on === p.ends_on) {
      pushEvent(events, { date: p.starts_on, type: "promotion", label: p.name, sublabel: p.status, edge: "single" });
      continue;
    }
    pushEvent(events, { date: p.starts_on, type: "promotion", label: p.name, sublabel: p.status, edge: "start" });
    pushEvent(events, { date: p.ends_on, type: "promotion", label: p.name, sublabel: p.status, edge: "end" });
  }

  for (const h of holidayPeaks) {
    if (h.starts_on && h.starts_on === h.ends_on) {
      pushEvent(events, { date: h.starts_on, type: "holiday", label: h.name, sublabel: h.status, edge: "single" });
      continue;
    }
    pushEvent(events, { date: h.starts_on, type: "holiday", label: h.name, sublabel: h.status, edge: "start" });
    pushEvent(events, { date: h.ends_on, type: "holiday", label: h.name, sublabel: h.status, edge: "end" });
  }

  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return String(a.label).localeCompare(String(b.label));
  });
}

/** Groups an already-sorted event list by "YYYY-MM" for a month-by-month view. */
export function groupCalendarEventsByMonth(events) {
  const groups = new Map();
  for (const e of events) {
    const key = String(e.date).slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].map(([month, items]) => ({ month, items }));
}

/**
 * Marketing Studio content calendar (Stage C) — turns Lily's planned
 * marketing_content_items + their marketing_platform_variants into the
 * same dated-event shape buildCalendarEvents() produces, so a single
 * calendar view can render campaigns/promotions/holidays alongside
 * planned content without two different event shapes.
 *
 * A content item's calendar date is the EARLIEST scheduled_at among its
 * variants (variants normally share one target date across platforms —
 * see marketing-content-planner.js). An item with no variants yet (should
 * not normally happen once plan_month has run, but never assumed) is
 * simply omitted rather than guessed at.
 */
export function buildContentCalendarEvents({ contentItems = [], variants = [] } = {}) {
  const earliestByItem = new Map();
  for (const v of variants) {
    if (!v.content_item_id || !v.scheduled_at) continue;
    const dateOnly = String(v.scheduled_at).slice(0, 10);
    const current = earliestByItem.get(v.content_item_id);
    if (!current || dateOnly < current) earliestByItem.set(v.content_item_id, dateOnly);
  }

  const events = [];
  for (const item of contentItems) {
    const date = earliestByItem.get(item.id);
    if (!date) continue;
    pushEvent(events, { date, type: "content", label: item.title, sublabel: item.status, edge: "single" });
  }

  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return String(a.label).localeCompare(String(b.label));
  });
}
