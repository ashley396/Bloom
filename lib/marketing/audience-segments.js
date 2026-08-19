/**
 * Marketing Command Center — customer audience segmentation.
 *
 * Every segment is built from real customers/orders data for the shop and
 * is ALWAYS filtered to customers who explicitly opted in to marketing
 * (contact_preferences.marketing_opt_in === true) before any other
 * criteria are applied. There is no segment definition anywhere in this
 * file that can return a customer who hasn't opted in — that filter runs
 * first, unconditionally, so a future segment added here can't
 * accidentally skip it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function hasMarketingOptIn(customer) {
  const prefs = customer?.contact_preferences;
  return Boolean(prefs && typeof prefs === "object" && prefs.marketing_opt_in === true);
}

function ordersByCustomer(orders) {
  const map = new Map();
  for (const order of orders || []) {
    if (!order?.customer_id) continue;
    const list = map.get(order.customer_id) || [];
    list.push(order);
    map.set(order.customer_id, list);
  }
  return map;
}

function occasionMatches(order, pattern) {
  return pattern.test(String(order?.occasion || ""));
}

const OCCASION_SEGMENTS = [
  { key: "past_mothers_day_buyers", label: "Past Mother's Day buyers", pattern: /mother/i },
  { key: "past_valentines_buyers", label: "Past Valentine's buyers", pattern: /valentine/i },
  { key: "past_christmas_buyers", label: "Past Christmas buyers", pattern: /christmas|holiday/i },
  { key: "wedding_customers", label: "Wedding customers", pattern: /wedding/i },
  { key: "sympathy_customers", label: "Sympathy customers", pattern: /sympathy|funeral|memorial/i },
];

/**
 * @param {object} params
 * @param {Array} params.customers - shop's customers (id, contact_preferences, vip, birthday, anniversary, created_at)
 * @param {Array} params.orders - shop's orders (customer_id, occasion, total, fulfillment, created_at)
 * @param {Date} [params.now]
 * @returns {{segments: Array<{key:string,label:string,count:number,customerIds:string[]}>, subscriberCount: number}}
 */
export function buildAudienceSegments({ customers = [], orders = [], now = new Date() } = {}) {
  const subscribers = customers.filter(hasMarketingOptIn);
  const subscriberIds = new Set(subscribers.map((c) => c.id));
  const ordersFromSubscribers = orders.filter((o) => o.customer_id && subscriberIds.has(o.customer_id));
  const byCustomer = ordersByCustomer(ordersFromSubscribers);
  const nowMs = now.getTime();
  const thisMonth = now.getMonth();

  function ids(predicate) {
    return subscribers.filter(predicate).map((c) => c.id);
  }

  const segments = [];
  const add = (key, label, customerIds) => segments.push({ key, label, count: customerIds.length, customerIds });

  add("all_subscribers", "All marketing subscribers", subscribers.map((c) => c.id));
  add("vip", "VIP customers", ids((c) => c.vip === true));

  add(
    "repeat",
    "Repeat customers (2+ orders)",
    ids((c) => (byCustomer.get(c.id) || []).length >= 2)
  );
  add(
    "high_spend",
    "High-spend customers ($300+ lifetime)",
    ids((c) => (byCustomer.get(c.id) || []).reduce((sum, o) => sum + Number(o.total || 0), 0) >= 300)
  );
  add(
    "new",
    "New customers (last 30 days)",
    ids((c) => c.created_at && nowMs - new Date(c.created_at).getTime() <= 30 * DAY_MS)
  );
  add(
    "lapsed",
    "Haven't ordered in a year",
    ids((c) => {
      const history = byCustomer.get(c.id) || [];
      if (!history.length) return false;
      const mostRecent = Math.max(...history.map((o) => new Date(o.created_at || 0).getTime()));
      return nowMs - mostRecent > 365 * DAY_MS;
    })
  );
  add(
    "birthday_this_month",
    "Birthdays this month",
    ids((c) => c.birthday && new Date(`${c.birthday}T00:00:00Z`).getUTCMonth() === thisMonth)
  );
  add(
    "anniversary_this_month",
    "Anniversaries this month",
    ids((c) => c.anniversary && new Date(`${c.anniversary}T00:00:00Z`).getUTCMonth() === thisMonth)
  );
  add(
    "local_delivery",
    "Local delivery customers",
    ids((c) => (byCustomer.get(c.id) || []).some((o) => o.fulfillment === "DELIVERY"))
  );

  for (const { key, label, pattern } of OCCASION_SEGMENTS) {
    add(
      key,
      label,
      ids((c) => (byCustomer.get(c.id) || []).some((o) => occasionMatches(o, pattern)))
    );
  }

  return { segments, subscriberCount: subscribers.length };
}
