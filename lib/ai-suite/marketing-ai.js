/**
 * AI Marketing module — segmentation, personalization, campaign strategy.
 * Pure functions: client or server passes orders/customers; no MongoDB required.
 */

const OCCASION_KEYWORDS = {
  sympathy: /sympathy|funeral|memorial|spray|wreath/i,
  wedding: /wedding|bridal|ceremony|reception/i,
  romance: /rose|romance|anniversary|valentine/i,
  birthday: /birthday|celebration|balloon/i,
  corporate: /corporate|office|client|business/i
};

export function segmentCustomers(customers = [], orders = []) {
  const byCustomer = new Map();
  for (const o of orders) {
    const key = String(o.customer_id || o.customer_email || o.customer_name || "").toLowerCase();
    if (!key) continue;
    const row = byCustomer.get(key) || {
      id: o.customer_id,
      name: o.customer_name,
      email: o.customer_email,
      order_count: 0,
      total_spent: 0,
      last_order_at: null,
      occasions: new Set()
    };
    row.order_count += 1;
    row.total_spent += Number(o.total || o.subtotal || 0);
    const at = o.created_at || o.delivery_date;
    if (at && (!row.last_order_at || at > row.last_order_at)) row.last_order_at = at;
    const text = [o.arrangement_description, o.notes, o.card_message].join(" ");
    for (const [occ, re] of Object.entries(OCCASION_KEYWORDS)) {
      if (re.test(text)) row.occasions.add(occ);
    }
    byCustomer.set(key, row);
  }

  const now = Date.now();
  const segments = {
    vip: [],
    at_risk: [],
    new_buyers: [],
    sympathy_focused: [],
    wedding_focused: [],
    everyday: []
  };

  for (const c of customers) {
    const key = String(c.id || c.email || c.name || "").toLowerCase();
    const stats = byCustomer.get(key) || { order_count: 0, total_spent: 0, occasions: new Set() };
    const profile = {
      id: c.id,
      name: c.name || stats.name,
      email: c.email || stats.email,
      order_count: stats.order_count,
      total_spent: Math.round(stats.total_spent * 100) / 100,
      occasions: [...stats.occasions]
    };

    if (stats.total_spent >= 500 || stats.order_count >= 8) segments.vip.push(profile);
    else if (stats.order_count === 0) segments.new_buyers.push(profile);
    else if (stats.last_order_at) {
      const days = (now - new Date(stats.last_order_at).getTime()) / 86400000;
      if (days > 90 && stats.order_count >= 2) segments.at_risk.push(profile);
    }
    if (stats.occasions.has("sympathy")) segments.sympathy_focused.push(profile);
    else if (stats.occasions.has("wedding")) segments.wedding_focused.push(profile);
    else if (stats.order_count > 0) segments.everyday.push(profile);
  }

  return {
    segments,
    summary: {
      total_customers: customers.length,
      vip: segments.vip.length,
      at_risk: segments.at_risk.length,
      new_buyers: segments.new_buyers.length
    },
    kpis: {
      avg_orders_per_customer:
        customers.length > 0 ? Math.round((orders.length / customers.length) * 10) / 10 : 0
    }
  };
}

export function buildMarketingStrategy({ shop = {}, segments = {}, season = null } = {}) {
  const name = shop.name || "Your shop";
  const city = shop.city || parseCity(shop.address);
  const month = season || new Date().toLocaleString("en-US", { month: "long" });

  const tactics = [];

  if (segments.at_risk?.length) {
    tactics.push({
      channel: "email",
      audience: "at_risk",
      title: "We miss you — fresh flowers for your table",
      goal: "Win back customers who have not ordered in 90+ days",
      message_angle: `Personal note from ${name} with a simple reorder CTA and local delivery mention${city ? ` in ${city}` : ""}.`
    });
  }
  if (segments.vip?.length) {
    tactics.push({
      channel: "email",
      audience: "vip",
      title: "VIP early access — new seasonal designs",
      goal: "Reward top spenders with first look at new arrangements",
      message_angle: "Exclusive preview and optional concierge ordering."
    });
  }
  if (segments.sympathy_focused?.length) {
    tactics.push({
      channel: "email",
      audience: "sympathy_focused",
      title: "Compassionate sympathy collection",
      goal: "Support families with respectful, timely delivery",
      message_angle: "Calm tone, clear delivery windows, no discount language."
    });
  }
  tactics.push({
    channel: "instagram",
    audience: "everyday",
    title: `${month} florist favorites`,
    goal: "Drive same-week orders from local followers",
    message_angle: `Show real arrangement photos from ${name}; link to online shop.`
  });

  return {
    shop: name,
    season: month,
    tactics,
    personalization_rules: [
      "Use customer first name when available",
      "Reference last order occasion when known",
      "Never send sympathy promos to wedding-only segments",
      "Cap email frequency at 2 per month unless opted in"
    ],
    recommended_send_times: { email: "Tue–Thu 9–11am local", instagram: "Wed–Fri 11am–1pm" }
  };
}

export function draftCampaignCopy({ channel = "email", tactic = {}, shop = {} }) {
  const name = shop.name || "Your local florist";
  return {
    channel,
    subject: tactic.title || `${name} — flowers for every moment`,
    preview_text: tactic.message_angle || `Fresh designs from ${name}.`,
    body_outline: [
      "Warm greeting with shop name",
      tactic.message_angle || "Highlight seasonal arrangements",
      "Clear CTA: Shop online or call to order",
      "Footer: address, phone, unsubscribe"
    ],
    lily_note: "Review and edit before scheduling — Lily drafts are suggestions only."
  };
}

function parseCity(address = "") {
  const parts = String(address).split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}
