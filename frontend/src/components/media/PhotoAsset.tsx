import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";

/** Default shop photography when no user-specific image is available (real photo, not illustration). */
export const DEFAULT_SHOP_PHOTO = "/assets/auth/luxury-florist-workspace.jpg";

export type PhotoAssetProps = {
  src?: string | null;
  alt: string;
  fallbackSrc?: string | null;
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
  alt,
  fallbackSrc,
  className,
  aspect = "video",
  priority = false,
}: PhotoAssetProps) {
  const chain = useMemo(
    () =>
      [...new Set([src, fallbackSrc, DEFAULT_SHOP_PHOTO].filter(Boolean))] as string[],
    [src, fallbackSrc],
  );

  const [index, setIndex] = useState(0);
  const current = chain[Math.min(index, chain.length - 1)] ?? DEFAULT_SHOP_PHOTO;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-florisyn-sage-100",
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
        onError={() => {
          setIndex((i) => (i + 1 < chain.length ? i + 1 : i));
        }}
      />
    </div>
  );
}
