import type { FloristryPhotoId } from "../../lib/floristry-photo-library";
import { PhotoAsset } from "../media/PhotoAsset";
import { cn } from "../../lib/utils";

export type TodayHeroPhotoProps = {
  photoId: FloristryPhotoId;
  pageSlot: string;
  firstName: string;
  dateLabel: string;
  className?: string;
};

/**
 * Studio hero — editorial greeting over florist workspace photography.
 */
export function TodayHeroPhoto({
  photoId,
  pageSlot,
  firstName,
  dateLabel,
  className,
}: TodayHeroPhotoProps) {
  return (
    <section
      className={cn(
        "animate-fade-in relative isolate overflow-hidden rounded-3xl shadow-elevated ring-1 ring-florisyn-border",
        className,
      )}
      aria-labelledby="today-greeting"
    >
      <PhotoAsset
        photoId={photoId}
        pageSlot={pageSlot}
        alt="Florist design studio with fresh flowers on the bench"
        aspect="auto"
        priority
        className="min-h-[min(52vw,320px)] w-full rounded-none md:min-h-[340px] lg:min-h-[380px]"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-charcoal/75 via-charcoal/45 to-charcoal/15 md:via-charcoal/35 md:to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-charcoal/50 via-transparent to-charcoal/10"
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 p-8 md:p-10 lg:p-12">
        <p className="text-label text-warm-ivory/75">Today</p>
        <h1
          id="today-greeting"
          className="font-serif-display mt-3 max-w-2xl text-[2.125rem] font-medium leading-[1.12] text-warm-ivory md:text-5xl lg:text-[3.25rem]"
        >
          Good morning, {firstName}
        </h1>
        <p className="mt-4 text-base text-warm-ivory/90 md:text-lg">
          <time dateTime={dateLabel}>{dateLabel}</time>
        </p>
      </div>
    </section>
  );
}
