import type { FloristryPhotoId } from "../../floristry-photo-library";
import { assertUniquePhotoAssignments } from "../../floristry-photo-library";

/** Every visible photo slot on `/today` — one unique catalog ID each. FROZEN slot map. */
export type TodayPhotoSlotId =
  | "today.hero"
  | "today.up-next"
  | "today.design-queue.dq-1"
  | "today.design-queue.dq-2"
  | "today.design-queue.dq-3"
  | "today.design-queue.dq-4"
  | "today.inventory.inv-1"
  | "today.inventory.inv-2"
  | "today.inventory.inv-3";

export const TODAY_PHOTO_ASSIGNMENTS: Record<TodayPhotoSlotId, FloristryPhotoId> =
  {
    "today.hero": "workspace-hero-bench",
    "today.up-next": "sympathy-funeral-spray",
    "today.design-queue.dq-1": "sympathy-lilies",
    "today.design-queue.dq-2": "mixed-everyday-bouquet",
    "today.design-queue.dq-3": "wedding-bridal-bouquet",
    "today.design-queue.dq-4": "centerpiece-table",
    "today.inventory.inv-1": "roses-white-bunch",
    "today.inventory.inv-2": "hydrangea-blue",
    "today.inventory.inv-3": "plant-potted-green",
  };

export function getTodayPhotoId(slot: TodayPhotoSlotId): FloristryPhotoId {
  return TODAY_PHOTO_ASSIGNMENTS[slot];
}

export function collectTodayPhotoAssignmentEntries(): ReadonlyArray<{
  slot: string;
  photoId: FloristryPhotoId;
}> {
  return Object.entries(TODAY_PHOTO_ASSIGNMENTS).map(([slot, photoId]) => ({
    slot,
    photoId,
  }));
}

export function validateTodayPhotoAssignments(pageLabel = "/today"): void {
  assertUniquePhotoAssignments(collectTodayPhotoAssignmentEntries(), pageLabel);
}

validateTodayPhotoAssignments();
