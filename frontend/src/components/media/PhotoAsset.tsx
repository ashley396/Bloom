import { Flower2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getFloristryPhotoSrc,
  type FloristryPhotoId,
} from "../../lib/floristry-photo-library";
import { cn } from "../../lib/utils";
import { usePagePhotoRegistry } from "./page-photo-registry";

/**
 * Florisyn photography policy:
 * - Real licensed floral photography only (catalog IDs or explicit uploads).
 * - Never repeat the same catalog ID on one page (see PagePhotoRegistry).
 * - On load failure, show a neutral empty state — do not substitute another card’s image.
 */

/** Legacy shop workspace — only for single-image surfaces outside multi-card pages. */
export const DEFAULT_SHOP_PHOTO = "/assets/auth/luxury-florist-workspace.jpg";

export type PhotoAssetProps = {
  /** Preferred: typed catalog asset. */
  photoId?: FloristryPhotoId;
  /** User upload / order photo (explicit URL). */
  src?: string | null;
  /** Shop floral library entry (user-managed catalog). */
  floristLibrarySrc?: string | null;
  alt: string;
  className?: string;
  aspect?: "video" | "square" | "portrait" | "auto";
  priority?: boolean;
  /** Registers usage with PagePhotoRegistry when both photoId and pageSlot are set. */
  pageSlot?: string;
  /**
   * When true, a missing/failed image may use DEFAULT_SHOP_PHOTO once.
   * Must stay false on Today and any multi-card screen.
   */
  allowShopDefaultFallback?: boolean;
};

const aspectClass: Record<NonNullable<PhotoAssetProps["aspect"]>, string> = {
  video: "aspect-video",
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  auto: "",
};

function PhotoEmptyState({
  alt,
  className,
  aspect,
}: {
  alt: string;
  className?: string;
  aspect: PhotoAssetProps["aspect"];
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 bg-warm-cream-deep text-charcoal-subtle ring-1 ring-inset ring-florisyn-border/60 dark:bg-florisyn-sage-900/40",
        aspect !== "auto" && aspectClass[aspect ?? "video"],
        className,
      )}
      role="img"
      aria-label={alt}
    >
      <Flower2 className="size-6 opacity-40" strokeWidth={1.25} aria-hidden />
      <span className="sr-only">{alt}</span>
    </div>
  );
}

export function PhotoAsset({
  photoId,
  src,
  floristLibrarySrc,
  alt,
  className,
  aspect = "video",
  priority = false,
  pageSlot,
  allowShopDefaultFallback = false,
}: PhotoAssetProps) {
  const registry = usePagePhotoRegistry();

  useEffect(() => {
    if (photoId && pageSlot) {
      registry?.registerPhotoSlot(photoId, pageSlot);
    }
  }, [photoId, pageSlot, registry]);

  const resolvedSrc = useMemo(() => {
    if (photoId) return getFloristryPhotoSrc(photoId);
    if (src) return src;
    if (floristLibrarySrc) return floristLibrarySrc;
    return null;
  }, [photoId, src, floristLibrarySrc]);

  const [failed, setFailed] = useState(false);
  const [shopFallbackFailed, setShopFallbackFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setShopFallbackFailed(false);
  }, [resolvedSrc]);

  const showShopFallback =
    allowShopDefaultFallback &&
    failed &&
    !shopFallbackFailed &&
    resolvedSrc !== DEFAULT_SHOP_PHOTO;

  if (!resolvedSrc || (failed && !showShopFallback)) {
    return (
      <PhotoEmptyState alt={alt} className={className} aspect={aspect} />
    );
  }

  const imageSrc = showShopFallback ? DEFAULT_SHOP_PHOTO : resolvedSrc;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-sage-pale dark:bg-florisyn-sage-900/50",
        aspect !== "auto" && aspectClass[aspect],
        className,
      )}
    >
      <img
        src={imageSrc}
        alt={alt}
        className="h-full w-full object-cover motion-safe-transition"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onError={() => {
          if (showShopFallback) {
            setShopFallbackFailed(true);
          } else {
            setFailed(true);
          }
        }}
      />
    </div>
  );
}
