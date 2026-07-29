/**
 * Florisyn photography standard — real professional floral imagery only.
 * Assets live under `/assets/floristry/` (Vite public). Sources: Pexels / Unsplash
 * (free license; florist-facing UI, not resold as stock).
 *
 * Policy:
 * - Never repeat the same photograph on one screen.
 * - No food, balloons, or illustrative PNG “clip art” in photo slots.
 * - At most one premium chocolate box image when used as an optional gift add-on (not on Today).
 */

export type FloristryPhotoCategory =
  | "sympathy"
  | "everyday"
  | "roses"
  | "hydrangea"
  | "mixed"
  | "wedding"
  | "centerpiece"
  | "plant"
  | "seasonal"
  | "workspace";

export type FloristryPhoto = {
  id: string;
  src: string;
  category: FloristryPhotoCategory;
  /** Human-readable credit for internal reference */
  credit: string;
};

const base = "/assets/floristry";

/** Curated catalog — each file is a distinct photograph on disk. */
export const FLORISTRY_PHOTOS = {
  heroWorkbench: {
    id: "hero-workbench",
    src: `${base}/hero-workbench.jpg`,
    category: "workspace",
    credit: "Unsplash — florist workbench",
  },
  funeralSpray: {
    id: "funeral-spray",
    src: `${base}/funeral-spray.jpg`,
    category: "sympathy",
    credit: "Pexels",
  },
  sympathyLilies: {
    id: "sympathy-lilies",
    src: `${base}/sympathy-lilies.jpg`,
    category: "sympathy",
    credit: "Pexels",
  },
  corporateLobby: {
    id: "corporate-lobby",
    src: `${base}/corporate-lobby.jpg`,
    category: "mixed",
    credit: "Pexels",
  },
  birthdayPastel: {
    id: "birthday-pastel",
    src: `${base}/birthday-pastel.jpg`,
    category: "everyday",
    credit: "Pexels",
  },
  centerpieceTable: {
    id: "centerpiece-table",
    src: `${base}/centerpiece-table.jpg`,
    category: "centerpiece",
    credit: "Unsplash",
  },
  whiteRoses: {
    id: "white-roses",
    src: `${base}/white-roses.jpg`,
    category: "roses",
    credit: "Pexels",
  },
  hydrangeaBlue: {
    id: "hydrangea-blue",
    src: `${base}/hydrangea-blue.jpg`,
    category: "hydrangea",
    credit: "Pexels",
  },
  pottedPlant: {
    id: "potted-plant",
    src: `${base}/potted-plant.jpg`,
    category: "plant",
    credit: "Pexels",
  },
  everydayMixed: {
    id: "everyday-mixed",
    src: `${base}/everyday-mixed.jpg`,
    category: "mixed",
    credit: "Pexels",
  },
  rosesRed: {
    id: "roses-red",
    src: `${base}/roses-red.jpg`,
    category: "roses",
    credit: "Pexels",
  },
  weddingFlowers: {
    id: "wedding-flowers",
    src: `${base}/wedding-flowers.jpg`,
    category: "wedding",
    credit: "Unsplash",
  },
  seasonalSpring: {
    id: "seasonal-spring",
    src: `${base}/seasonal-spring.jpg`,
    category: "seasonal",
    credit: "Unsplash",
  },
  gardenHarmony: {
    id: "garden-harmony",
    src: `${base}/everyday-garden-harmony.jpg`,
    category: "everyday",
    credit: "Florisyn library — garden harmony",
  },
  sunflowers: {
    id: "sunflowers",
    src: `${base}/sunflowers.jpg`,
    category: "seasonal",
    credit: "Unsplash",
  },
  tulipsSpring: {
    id: "tulips-spring",
    src: `${base}/tulips-spring.jpg`,
    category: "seasonal",
    credit: "Pexels",
  },
  orchidElegant: {
    id: "orchid-elegant",
    src: `${base}/orchid-elegant.jpg`,
    category: "mixed",
    credit: "Pexels",
  },
} as const satisfies Record<string, FloristryPhoto>;

/** Unique assignments for `/today` — one photo per slot, no repeats. */
export const TODAY_PAGE_PHOTOS = {
  hero: FLORISTRY_PHOTOS.heroWorkbench,
  upNext: FLORISTRY_PHOTOS.funeralSpray,
  designQueue: {
    "dq-1": FLORISTRY_PHOTOS.sympathyLilies,
    "dq-2": FLORISTRY_PHOTOS.corporateLobby,
    "dq-3": FLORISTRY_PHOTOS.birthdayPastel,
    "dq-4": FLORISTRY_PHOTOS.centerpieceTable,
  },
  inventory: {
    "inv-1": FLORISTRY_PHOTOS.whiteRoses,
    "inv-2": FLORISTRY_PHOTOS.hydrangeaBlue,
    "inv-3": FLORISTRY_PHOTOS.pottedPlant,
  },
} as const;

export function collectTodayPagePhotoUrls(): string[] {
  const dq = Object.values(TODAY_PAGE_PHOTOS.designQueue).map((p) => p.src);
  const inv = Object.values(TODAY_PAGE_PHOTOS.inventory).map((p) => p.src);
  return [
    TODAY_PAGE_PHOTOS.hero.src,
    TODAY_PAGE_PHOTOS.upNext.src,
    ...dq,
    ...inv,
  ];
}

/** Guard: duplicate photos on one screen break Florisyn trust (logs in all builds). */
export function assertUniquePhotosOnPage(urls: string[], pageLabel: string): void {
  const seen = new Map<string, number>();
  for (const url of urls) {
    if (!url) continue;
    seen.set(url, (seen.get(url) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1);
  if (dupes.length > 0) {
    console.error(
      `[Florisyn photography] Duplicate images on ${pageLabel}:`,
      dupes.map(([url, count]) => `${url} (×${count})`),
    );
  }
}
