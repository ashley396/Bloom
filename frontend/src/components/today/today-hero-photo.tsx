import type { FloristryPhotoId } from "../../lib/floristry-photo-library";
import { PhotoAsset } from "../media/PhotoAsset";
import { cn } from "../../lib/utils";

export type TodayHeroPhotoProps = {
  photoId: FloristryPhotoId;
  pageSlot: string;
  alt?: string;
  className?: string;
};

/**
 * Restrained hero photography — supports the dashboard without overpowering metrics.
 */
export function TodayHeroPhoto({
  photoId,
  pageSlot,
  alt = "Fresh seasonal arrangement from the design bench",
  className,
}: TodayHeroPhotoProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl ring-1 ring-florisyn-border",
        className,
      )}
    >
      <PhotoAsset
        photoId={photoId}
        pageSlot={pageSlot}
        alt={alt}
        aspect="video"
        priority
        className="max-h-[min(220px,28vh)] rounded-2xl opacity-[0.92] dark:opacity-80"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-warm-cream/90 via-warm-cream/20 to-transparent dark:from-charcoal/80 dark:via-charcoal/10"
        aria-hidden
      />
    </div>
  );
}
