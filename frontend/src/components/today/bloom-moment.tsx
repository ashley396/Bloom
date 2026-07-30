import { Sparkles } from "lucide-react";
import {
  bloomMomentCategoryLabel,
  getTodaysBloomMoment,
  type BloomMomentEntry,
} from "../../lib/bloom-moment-quotes";
import { cn } from "../../lib/utils";

export type BloomMomentProps = {
  entry?: BloomMomentEntry;
  className?: string;
};

export function BloomMoment({ entry, className }: BloomMomentProps) {
  const moment = entry ?? getTodaysBloomMoment();
  const categoryLabel = bloomMomentCategoryLabel[moment.category];

  return (
    <aside
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gradient-to-br from-warm-ivory via-warm-cream to-champagne-pale p-8 md:p-10",
        "ring-1 ring-champagne-gold/20 shadow-card",
        "motion-safe:animate-[bloom-reveal_0.8s_ease-out_both]",
        className,
      )}
      aria-labelledby="bloom-moment-title"
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full bg-champagne-gold/8 blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-12 -left-12 size-48 rounded-full bg-sage-pale/40 blur-3xl"
        aria-hidden
      />

      <div className="relative flex items-start gap-4">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-champagne-gold/12 text-champagne-gold ring-1 ring-champagne-gold/20"
          aria-hidden
        >
          <Sparkles className="size-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p id="bloom-moment-title" className="text-label text-champagne-gold">
            Bloom moment · {categoryLabel}
          </p>
          <blockquote className="mt-4 font-serif-display text-2xl font-medium leading-snug text-charcoal md:text-[1.75rem] md:leading-snug">
            &ldquo;{moment.text}&rdquo;
          </blockquote>
          {moment.attribution ? (
            <footer className="mt-4 text-sm font-medium text-charcoal-subtle">
              — {moment.attribution}
            </footer>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
