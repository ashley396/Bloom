/**
 * Florisyn typed photo library — one catalog ID maps to exactly one on-disk photograph.
 * Do not use alternate crops of the same source as separate IDs.
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
  | "premium-chocolate-gift";

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
    credit: "Unsplash",
  },
  "sympathy-funeral-spray": {
    id: "sympathy-funeral-spray",
    file: `${floristryBase}/funeral-spray.jpg`,
    category: "sympathy",
    credit: "Pexels",
  },
  "sympathy-lilies": {
    id: "sympathy-lilies",
    file: `${floristryBase}/sympathy-lilies.jpg`,
    category: "sympathy",
    credit: "Pexels",
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
    credit: "Pexels",
  },
  "workspace-hero-bench": {
    id: "workspace-hero-bench",
    file: `${floristryBase}/hero-workbench.jpg`,
    category: "workspace",
    credit: "Unsplash",
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
    credit: "Pexels",
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
  /** Optional gift add-on only — not used on multi-card pages like /today. */
  "premium-chocolate-gift": {
    id: "premium-chocolate-gift",
    file: `${floristryBase}/premium-chocolate-gift.jpg`,
    category: "mixed-everyday",
    credit: "Reserved slot — add real licensed product photo when gift UI ships",
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
