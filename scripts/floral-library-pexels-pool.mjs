/**
 * Florisyn-owned professional arrangement photography (visually verified).
 */
import verifiedPexelsIds from "./floral-library-arrangement-ids.json" with { type: "json" };

export const EVERYDAY_PEXELS_POOL = verifiedPexelsIds;

export const FLORISYN_ARRANGEMENT_SOURCES = [
  { file: "assets/floral-library/florisyn-everyday-sunny-bouquet.jpg", tags: ["sunflower", "bright", "yellow", "sunny"] },
  { file: "assets/floral-library/florisyn-everyday-spring-pastels.jpg", tags: ["pastel", "blush", "lavender", "peach", "pink"] },
  { file: "assets/floral-library/garden-harmony.jpg", tags: ["hydrangea", "blue", "white", "sympathy"] },
  { file: "assets/floral-library/florisyn-everyday-rose-pitcher.jpg", tags: ["rose", "romance", "pitcher", "classic"] },
  { file: "assets/floral-library/florisyn-everyday-garden-medley.jpg", tags: ["garden", "medley", "harvest"] },
  { file: "assets/floral-library/florisyn-everyday-market-wildflowers.jpg", tags: ["rustic", "wildflower", "market", "mason", "jar"] },
  { file: "assets/floral-library/florisyn-everyday-daisies-tulips.jpg", tags: ["daisy", "mum", "cheerful"] },
  { file: "assets/floral-library/florisyn-arrangement-signature-blush.jpg", tags: ["luxury", "elegance", "blush", "lily"] },
  { file: "assets/atelier-bouquet-hero.jpg", tags: ["luxury", "designer", "bouquet"] }
];

export function pexelsDownloadUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
}

export function pexelsAttribution(photoId) {
  return `Pexels — verified vase/bouquet arrangement (photo ${photoId})`;
}

export function scoreLocalMatch(arrangement, source) {
  const text = [
    arrangement.name,
    arrangement.style,
    arrangement.color_palette,
    ...(arrangement.categories || []),
    ...(arrangement.recipe || []).map((r) => r.name)
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const tag of source.tags) {
    if (text.includes(tag)) score += 2;
  }
  return score;
}
