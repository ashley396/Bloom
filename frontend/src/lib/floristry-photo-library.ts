/**
 * @internal File paths exist ONLY in this module. App code must use `@/lib/floral-asset-library`.
 * Florisyn Floral Asset Library (catalog) — FROZEN architecture; extend IDs, do not redesign.
 */

export type FloristryPhotoCategory =
  | "sympathy"
  | "hydrangea"
  | "roses"
  | "mixed-everyday"
  | "wedding"
  | "centerpiece"
  | "plant"
  | "seasonal"
  | "workspace";

/** Stable catalog identifiers — never reuse the same ID for different files. */
export type FloristryPhotoId =
  | "seasonal-spring"
  | "sympathy-funeral-spray"
  | "sympathy-lilies"
  | "mixed-everyday-bouquet"
  | "roses-red-bouquet"
  | "wedding-bridal-bouquet"
  | "centerpiece-table"
  | "roses-white-bunch"
  | "hydrangea-blue"
  | "plant-potted-green"
  | "workspace-hero-bench"
  | "mixed-garden-harmony"
  | "mixed-corporate-lobby"
  | "everyday-birthday-pastel"
  | "seasonal-sunflowers"
  | "seasonal-tulips"
  | "orchid-elegant"
  | "premium-chocolate-gift"
  | "workspace-luxury-shop";

export type FloristryPhotoRecord = {
  id: FloristryPhotoId;
  /** Public URL path (Vite `public/`). */
  file: string;
  category: FloristryPhotoCategory;
  credit: string;
};

const floristryBase = "/assets/floristry";

export const FLORISTRY_PHOTO_LIBRARY: Record<
  FloristryPhotoId,
  FloristryPhotoRecord
> = {
  "seasonal-spring": {
    id: "seasonal-spring",
    file: `${floristryBase}/seasonal-spring.jpg`,
    category: "seasonal",
    credit: "Pexels #792942 — spring blossoms",
  },
  "sympathy-funeral-spray": {
    id: "sympathy-funeral-spray",
    file: `${floristryBase}/sympathy-funeral-spray.jpg`,
    category: "sympathy",
    credit: "Pexels #7296680 — sympathy standing spray",
  },
  "sympathy-lilies": {
    id: "sympathy-lilies",
    file: `${floristryBase}/sympathy-lilies.jpg`,
    category: "sympathy",
    credit: "Pexels #1181395 — white lilies",
  },
  "mixed-everyday-bouquet": {
    id: "mixed-everyday-bouquet",
    file: `${floristryBase}/everyday-mixed.jpg`,
    category: "mixed-everyday",
    credit: "Pexels",
  },
  "roses-red-bouquet": {
    id: "roses-red-bouquet",
    file: `${floristryBase}/roses-red.jpg`,
    category: "roses",
    credit: "Pexels",
  },
  "wedding-bridal-bouquet": {
    id: "wedding-bridal-bouquet",
    file: `${floristryBase}/wedding-flowers.jpg`,
    category: "wedding",
    credit: "Unsplash",
  },
  "centerpiece-table": {
    id: "centerpiece-table",
    file: `${floristryBase}/centerpiece-table.jpg`,
    category: "centerpiece",
    credit: "Unsplash",
  },
  "roses-white-bunch": {
    id: "roses-white-bunch",
    file: `${floristryBase}/white-roses.jpg`,
    category: "roses",
    credit: "Pexels",
  },
  "hydrangea-blue": {
    id: "hydrangea-blue",
    file: `${floristryBase}/hydrangea-blue.jpg`,
    category: "hydrangea",
    credit: "Pexels",
  },
  "plant-potted-green": {
    id: "plant-potted-green",
    file: `${floristryBase}/potted-plant.jpg`,
    category: "plant",
    credit: "Pexels #1457813 — potted greenery",
  },
  "workspace-hero-bench": {
    id: "workspace-hero-bench",
    file: `${floristryBase}/hero-workbench.jpg`,
    category: "workspace",
    credit: "Pexels #6129129 — florist shop interior",
  },
  "mixed-garden-harmony": {
    id: "mixed-garden-harmony",
    file: `${floristryBase}/everyday-garden-harmony.jpg`,
    category: "mixed-everyday",
    credit: "Florisyn floral library",
  },
  "mixed-corporate-lobby": {
    id: "mixed-corporate-lobby",
    file: `${floristryBase}/corporate-lobby.jpg`,
    category: "mixed-everyday",
    credit: "Pexels #4579929 — interior floral arrangement",
  },
  "everyday-birthday-pastel": {
    id: "everyday-birthday-pastel",
    file: `${floristryBase}/birthday-pastel.jpg`,
    category: "mixed-everyday",
    credit: "Pexels",
  },
  "seasonal-sunflowers": {
    id: "seasonal-sunflowers",
    file: `${floristryBase}/sunflowers.jpg`,
    category: "seasonal",
    credit: "Unsplash",
  },
  "seasonal-tulips": {
    id: "seasonal-tulips",
    file: `${floristryBase}/tulips-spring.jpg`,
    category: "seasonal",
    credit: "Pexels",
  },
  "orchid-elegant": {
    id: "orchid-elegant",
    file: `${floristryBase}/orchid-elegant.jpg`,
    category: "mixed-everyday",
    credit: "Pexels",
  },
  /** Optional gift add-on only — file added when gift UI ships; not used on list pages. */
  "premium-chocolate-gift": {
    id: "premium-chocolate-gift",
    file: `${floristryBase}/premium-chocolate-gift.jpg`,
    category: "mixed-everyday",
    credit: "Reserved — premium chocolate box (optional gift add-on)",
  },
  "workspace-luxury-shop": {
    id: "workspace-luxury-shop",
    file: "/assets/auth/luxury-florist-workspace.jpg",
    category: "workspace",
    credit: "Florisyn — licensed shop workspace (single-image surfaces only)",
  },
};

export function getFloristryPhotoSrc(id: FloristryPhotoId): string {
  return FLORISTRY_PHOTO_LIBRARY[id].file;
}

export function getFloristryPhotoRecord(id: FloristryPhotoId): FloristryPhotoRecord {
  return FLORISTRY_PHOTO_LIBRARY[id];
}

/** Ensures assignment lists do not reuse catalog IDs or the same file path. */
export function assertUniquePhotoAssignments(
  assignments: ReadonlyArray<{ slot: string; photoId: FloristryPhotoId }>,
  pageLabel: string,
): void {
  const idSeen = new Map<FloristryPhotoId, string>();
  const fileSeen = new Map<string, string>();

  for (const { slot, photoId } of assignments) {
    const file = getFloristryPhotoSrc(photoId);
    if (idSeen.has(photoId)) {
      console.error(
        `[Florisyn photography] Duplicate photo ID "${photoId}" on ${pageLabel}: slots "${idSeen.get(photoId)}" and "${slot}"`,
      );
    } else {
      idSeen.set(photoId, slot);
    }
    if (fileSeen.has(file)) {
      console.error(
        `[Florisyn photography] Duplicate image file on ${pageLabel}: "${file}" used by "${fileSeen.get(file)}" and "${slot}"`,
      );
    } else {
      fileSeen.set(file, slot);
    }
  }
}
