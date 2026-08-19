/**
 * "LILY + WHOLESALE MARKETPLACE" from the marketplace vision — Lily
 * should be able to answer "find me 100 white roses for Friday" or "who
 * has Quicksand roses this week" with REAL supplier data, never invented
 * availability or pricing. This module is the grounded-answer path: it
 * detects a real flower-sourcing question, searches the real
 * marketplace_listings table (the same table the buyer browse UI reads),
 * and formats a real answer from real rows — deterministic, not an LLM
 * freeform guess, so pricing/availability can never be fabricated.
 */
import { FLOWER_LEXICON } from "./florist-community-recipes.js";
import { canBrowseListing, resolveDisplayPrice, isCurrentlyAvailable } from "./marketplace-products.js";
import { loadVerifiedSellerShopIds } from "./marketplace-verification.js";

const SOURCING_VERBS =
  /\b(find|source|sourcing|who has|which (?:wholesaler|supplier)s?|cheapest|least expensive|locally grown|available)\b/i;

/** Real flower names actually mentioned in the message — never a guess, only real lexicon hits. */
export function detectFlowerMentions(text = "") {
  const found = [];
  const used = new Set();
  for (const row of FLOWER_LEXICON) {
    if (!row.re.test(text)) continue;
    const key = row.name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    found.push(row.name);
  }
  return found;
}

/**
 * A message counts as a real marketplace-sourcing question only when it
 * both names a real flower AND uses sourcing language — "roses are
 * pretty" should not trigger a marketplace search, "find me roses"
 * should.
 */
export function isMarketplaceSourcingMessage(text = "") {
  return SOURCING_VERBS.test(text) && detectFlowerMentions(text).length > 0;
}

/**
 * Queries the real marketplace_listings table for real matches — the
 * exact same fields (canBrowseListing/resolveDisplayPrice/
 * isCurrentlyAvailable) the buyer browse UI already uses, so Lily's
 * answer can never disagree with what the Marketplace page itself shows.
 */
export async function searchMarketplaceForLily(client, flowerNames = [], { limit = 5, adminClient } = {}) {
  if (!flowerNames.length) return [];
  const { data, error } = await client
    .from("marketplace_listings")
    .select("*")
    .eq("active", true)
    .is("archived_at", null)
    .limit(200);
  if (error || !data) return [];

  const needles = flowerNames.map((n) => n.toLowerCase());
  const candidates = data
    .filter((row) => canBrowseListing(row))
    .filter((row) => {
      const haystack = [row.product_name, row.variety, row.supplier_name].filter(Boolean).join(" ").toLowerCase();
      return needles.some((n) => haystack.includes(n));
    });

  // SUPPLIER VERIFICATION: Lily must never point a florist toward a
  // seller the buyer catalog itself would hide — same
  // loadVerifiedSellerShopIds() check as the catalog, Reorder, and
  // Standing Orders gates, not a fourth parallel one. Computed only over
  // this message's candidate shops, not every listing in the table.
  const verifiedShopIds = await loadVerifiedSellerShopIds(candidates.map((row) => row.shop_id), { adminClient });

  const matches = candidates
    .filter((row) => verifiedShopIds.has(row.shop_id))
    .filter((row) => isCurrentlyAvailable(row))
    .map((row) => {
      const display = resolveDisplayPrice(row);
      return {
        id: row.id,
        shop_id: row.shop_id,
        supplier_name: row.supplier_name,
        product_name: row.product_name,
        price: display.price,
        unit: display.unit,
        pickup: Boolean(row.allows_local_pickup),
        shipping: row.allows_shipping !== false
      };
    })
    .filter((row) => row.price != null)
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
  return matches;
}

/** Deterministic, real-data-only answer text — never composed by an LLM. */
export function buildMarketplaceSourcingAnswer(matches, flowerNames) {
  const subject = flowerNames.join("/") || "that";
  if (!matches.length) {
    return `I checked the Wholesale Marketplace and don't see any listings for ${subject} right now. I've opened Marketplace search so you can broaden the search or check back later.`;
  }
  const lines = matches.map((m) => {
    const fulfillment = [m.pickup ? "pickup" : null, m.shipping ? "shipping" : null].filter(Boolean).join("/");
    return `${m.supplier_name || "A seller"} — ${m.product_name} — $${m.price.toFixed(2)}/${m.unit}${fulfillment ? ` (${fulfillment})` : ""}`;
  });
  const lead = matches.length > 1
    ? `I found ${matches.length} real listings for ${subject} in the Wholesale Marketplace, cheapest first:`
    : `I found this in the Wholesale Marketplace:`;
  return `${lead}\n${lines.join("\n")}\nOpening Marketplace search so you can review and order.`;
}
