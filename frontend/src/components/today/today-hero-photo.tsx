import { PhotoAsset } from "../media/PhotoAsset";
import { cn } from "../../lib/utils";

export type TodayHeroPhotoProps = {
  src: string;
  licensedFallbackSrc?: string;
  alt?: string;
  className?: string;
};

/**
 * Restrained hero photography — supports the dashboard without overpowering metrics.
 */
export function TodayHeroPhoto({
  src,
  licensedFallbackSrc,
  alt = "Fresh floral designs from today’s bench",
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
        src={src}
        licensedFallbackSrc={licensedFallbackSrc}
        suppressShopDefault
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
