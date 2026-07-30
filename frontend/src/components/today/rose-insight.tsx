import { TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils";
import { SurfaceCard } from "../ui/surface-card";

export type RoseInsightProps = {
  summary: string;
  metrics?: Array<{ label: string; value: string }>;
  className?: string;
};

/** Rose AI — Operations Director. Confident, calm, concise. */
export function RoseInsight({ summary, metrics, className }: RoseInsightProps) {
  return (
    <SurfaceCard
      as="aside"
      className={cn(
        "bg-gradient-to-br from-warm-white to-linen/80 ring-stone/20",
        className,
      )}
      aria-labelledby="rose-insight-title"
    >
      <div className="flex items-start gap-4">
        <span
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone/10 ring-1 ring-stone/15"
          aria-hidden
        >
          <img
            src="/assets/assistants/rose-portrait.svg"
            alt=""
            className="size-10 object-contain"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p id="rose-insight-title" className="text-label text-stone">
              Rose · Operations
            </p>
            <TrendingUp className="size-3.5 text-sage-muted" strokeWidth={1.75} aria-hidden />
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-charcoal">{summary}</p>
          {metrics && metrics.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-florisyn-border pt-5">
              {metrics.map((m) => (
                <div key={m.label}>
                  <dt className="text-xs font-medium uppercase tracking-wider text-charcoal-subtle">
                    {m.label}
                  </dt>
                  <dd className="mt-1 font-serif-display text-xl font-medium tabular-nums text-charcoal">
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}
