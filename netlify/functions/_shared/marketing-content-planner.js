/**
 * Lily's monthly content planner — Section 9 of the build directive
 * ("Lily, handle my marketing for September"). Turns a monthly allowance
 * (Section 14's configurable ~90-pieces/month default: 30 image posts, 30
 * Reels/shorts, 30 long-form videos) plus the real occasion calendar
 * (marketing-occasion-calendar.js) into a dated content SKELETON — what
 * type of piece, on what day, tied to which occasion if any.
 *
 * Deliberately NOT content generation. This plans the WHAT and WHEN;
 * Stage D's creative engine fills in the actual copy/image/video. A
 * planned item's title/brief here only ever uses generic, real content
 * angles (behind-the-scenes, fresh arrivals, an occasion name) — never a
 * fabricated product name, price, or customer detail. Pure functions
 * only; no database access.
 */

import { occasionsInMonth } from "./marketing-occasion-calendar.js";

export const CONTENT_TYPE_FOR_ALLOWANCE_KEY = Object.freeze({
  image_posts: "image_post",
  reels_or_shorts: "reel",
  long_form_videos: "long_video"
});

/** Evergreen angles used on days with no nearby occasion — real, generic
 * florist content categories, never a fabricated specific claim. */
export const EVERGREEN_CONTENT_ANGLES = Object.freeze([
  "Fresh arrivals spotlight",
  "Behind-the-scenes at the shop",
  "Customer favorite arrangement",
  "Seasonal color palette",
  "Meet the team",
  "Delivery day",
  "Design tip",
  "Shop update"
]);

const OCCASION_WINDOW_DAYS = 4;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00Z`).getTime();
  const b = new Date(`${isoB}T00:00:00Z`).getTime();
  return Math.abs(a - b) / 86400000;
}

/**
 * Proportionally interleaves content types by quota so a plan doesn't run
 * 30 image posts in a row before starting Reels — at every step, picks
 * whichever type is furthest behind its fair share (classic fair-queue
 * interleave). Deterministic: equal quotas always round-robin evenly.
 */
export function interleaveByQuota(quotas) {
  const types = Object.keys(quotas).filter((t) => (quotas[t] || 0) > 0);
  const total = types.reduce((sum, t) => sum + quotas[t], 0);
  const assigned = Object.fromEntries(types.map((t) => [t, 0]));
  const order = [];
  for (let i = 0; i < total; i += 1) {
    let best = null;
    let bestRatio = Infinity;
    for (const t of types) {
      const ratio = (assigned[t] + 1) / quotas[t];
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = t;
      }
    }
    assigned[best] += 1;
    order.push(best);
  }
  return order;
}

/** Spreads `count` items evenly across a month's real day count — the
 * source of the ~3-pieces/day cadence at the Section 9 default (90
 * items / 30 days). Returns one ISO date per item, in order. */
export function spreadAcrossMonth(year, month, count) {
  const totalDays = daysInMonth(year, month);
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    const day = Math.min(totalDays, Math.floor((i * totalDays) / count) + 1);
    dates.push(toIso(year, month, day));
  }
  return dates;
}

/** Finds the closest single-date occasion within OCCASION_WINDOW_DAYS of
 * a given date, or null. Month_range occasions (no single date) never
 * match here — see buildMonthlyContentPlan's separate seasonal_theme. */
function nearestOccasion(dateIso, occasions) {
  let best = null;
  let bestDistance = Infinity;
  for (const occasion of occasions) {
    if (!occasion.resolved) continue;
    const candidateDates = typeof occasion.resolved === "string" ? [occasion.resolved] : [occasion.resolved.start, occasion.resolved.end];
    for (const candidate of candidateDates) {
      const distance = daysBetween(dateIso, candidate);
      if (distance <= OCCASION_WINDOW_DAYS && distance < bestDistance) {
        bestDistance = distance;
        best = occasion;
      }
    }
  }
  return best;
}

function titleFor(contentType, occasion, angle) {
  const kindLabel = contentType === "image_post" ? "Image post" : contentType === "reel" ? "Reel" : "Video";
  return occasion ? `${kindLabel} — ${occasion.label}` : `${kindLabel} — ${angle}`;
}

function briefFor(occasion, angle) {
  return occasion
    ? `Tie this piece to ${occasion.label}. Ground it in real shop products, arrangements, and inventory — never a fabricated offer or price.`
    : `${angle}. Ground it in real shop products, arrangements, and inventory — never a fabricated offer or price.`;
}

/**
 * @param {object} params
 * @param {number} params.year
 * @param {number} params.month - 1-12
 * @param {object} [params.allowance] - {image_posts, reels_or_shorts, long_form_videos}
 * @param {string[]} [params.platforms] - which platforms each item targets by default
 * @returns {{ items: Array, occasions_in_month: Array }}
 */
export function buildMonthlyContentPlan({ year, month, allowance, platforms = [] }) {
  const occasions = occasionsInMonth(year, month);
  const quotas = {};
  for (const [allowanceKey, contentType] of Object.entries(CONTENT_TYPE_FOR_ALLOWANCE_KEY)) {
    const count = Math.max(0, Number(allowance?.[allowanceKey]) || 0);
    if (count > 0) quotas[contentType] = count;
  }

  const order = interleaveByQuota(quotas);
  const dates = spreadAcrossMonth(year, month, order.length);

  let angleCursor = 0;
  const items = order.map((contentType, i) => {
    const suggestedDate = dates[i];
    const occasion = nearestOccasion(suggestedDate, occasions);
    const angle = occasion ? null : EVERGREEN_CONTENT_ANGLES[angleCursor++ % EVERGREEN_CONTENT_ANGLES.length];
    return {
      content_type: contentType,
      suggested_date: suggestedDate,
      occasion_key: occasion?.key || null,
      title: titleFor(contentType, occasion, angle),
      brief: briefFor(occasion, angle),
      platforms: [...platforms],
      uses_ai_clone: false,
      requires_human_approval: true
    };
  });

  // Stable chronological order regardless of the interleave order above —
  // a calendar view should read top-to-bottom by date, not by content type.
  items.sort((a, b) => (a.suggested_date < b.suggested_date ? -1 : a.suggested_date > b.suggested_date ? 1 : 0));

  return { items, occasions_in_month: occasions };
}

/**
 * Approval workflow (Section 25: Generate → Review → Approve → Publish).
 * A content item can only be approved/rejected while it's still in a
 * pre-publish state — once it's scheduled or published, "reject" no longer
 * means anything (that's a cancel/unpublish action, not a review verdict).
 */
export const CONTENT_ITEM_APPROVABLE_STATUSES = Object.freeze(["idea", "generating", "draft", "in_review"]);

/** Given a content item's current status and a review decision, returns
 * the next status, or null if that decision isn't valid from this status
 * (the caller should reject the request rather than silently no-op). */
export function resolveApprovalDecision(currentStatus, decision) {
  if (!CONTENT_ITEM_APPROVABLE_STATUSES.includes(currentStatus)) return null;
  if (decision === "approved") return "approved";
  if (decision === "rejected") return "archived";
  return null;
}
