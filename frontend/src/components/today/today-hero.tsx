import { DEFAULT_SHOP_PHOTO } from "../media/PhotoAsset";
import { cn } from "../../lib/utils";

export type TodayHeroProps = {
  firstName: string;
  dateLabel: string;
  briefingLine: string;
  photoSrc?: string | null;
  className?: string;
};

export function TodayHero({
  firstName,
  dateLabel,
  briefingLine,
  photoSrc,
  className,
}: TodayHeroProps) {
  const image = photoSrc || DEFAULT_SHOP_PHOTO;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl shadow-card motion-safe-transition",
        "min-h-[280px] md:min-h-[320px] lg:min-h-[360px]",
        className,
      )}
      aria-labelledby="today-greeting"
    >
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="eager"
        fetchPriority="high"
        decoding="async"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-florisyn-ink/85 via-florisyn-ink/55 to-florisyn-ink/25 dark:from-black/90 dark:via-black/70 dark:to-black/40"
        aria-hidden
      />
      <div className="relative flex h-full flex-col justify-end p-8 md:p-10 lg:p-12">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/70">
          Florisyn Today
        </p>
        <h1
          id="today-greeting"
          className="font-display mt-3 max-w-2xl text-balance text-4xl font-semibold tracking-tight text-white md:text-5xl lg:text-[3.25rem] lg:leading-[1.08]"
        >
          Good Morning, {firstName}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
          {briefingLine}
        </p>
        <p className="mt-6 text-sm font-medium text-white/60">{dateLabel}</p>
      </div>
    </section>
  );
}
