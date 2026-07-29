import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * Licensed professional default — never AI-generated floral art.
 * Florists can override via `src` or `floristLibrarySrc`.
 */
export const DEFAULT_SHOP_PHOTO = "/assets/auth/luxury-florist-workspace.jpg";

export type PhotoAssetProps = {
  /** Primary image (product shot, order photo, upload). */
  src?: string | null;
  /** Shop floral library entry (user-managed catalog). */
  floristLibrarySrc?: string | null;
  alt: string;
  /** Licensed category / stock fallback before shop default. */
  licensedFallbackSrc?: string | null;
  className?: string;
  aspect?: "video" | "square" | "portrait" | "auto";
  priority?: boolean;
};

const aspectClass: Record<NonNullable<PhotoAssetProps["aspect"]>, string> = {
  video: "aspect-video",
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  auto: "",
};

export function PhotoAsset({
  src,
  floristLibrarySrc,
  alt,
  licensedFallbackSrc,
  className,
  aspect = "video",
  priority = false,
}: PhotoAssetProps) {
  const chain = useMemo(
    () =>
      [
        ...new Set(
          [src, floristLibrarySrc, licensedFallbackSrc, DEFAULT_SHOP_PHOTO].filter(
            Boolean,
          ),
        ),
      ] as string[],
    [src, floristLibrarySrc, licensedFallbackSrc],
  );

  const [index, setIndex] = useState(0);
  const current = chain[Math.min(index, chain.length - 1)] ?? DEFAULT_SHOP_PHOTO;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-sage-pale dark:bg-florisyn-sage-900/50",
        aspect !== "auto" && aspectClass[aspect],
        className,
      )}
    >
      <img
        src={current}
        alt={alt}
        className="h-full w-full object-cover motion-safe-transition"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onError={() => {
          setIndex((i) => (i + 1 < chain.length ? i + 1 : i));
        }}
      />
    </div>
  );
}
