import { ArrowRight } from "lucide-react";
import type { DesignQueueItem } from "../../lib/today-data";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

const statusLabel: Record<DesignQueueItem["status"], string> = {
  "in-progress": "In progress",
  waiting: "Waiting",
  ready: "Ready for pickup",
};

const statusStyle: Record<DesignQueueItem["status"], string> = {
  "in-progress": "bg-florisyn-sage-50 text-florisyn-sage-700 dark:bg-florisyn-sage-100/50",
  waiting: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  ready: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
};

type DesignQueueProps = {
  items: DesignQueueItem[];
  className?: string;
};

export function DesignQueue({ items, className }: DesignQueueProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="design-queue-heading">
      <SectionHeader
        title="Today's design queue"
        description="Bench order for the design team — not a metrics dashboard."
        action={
          <Button type="button" variant="ghost" size="sm" className="gap-1">
            View all
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        }
      />
      <h2 id="design-queue-heading" className="sr-only">
        Today&apos;s design queue
      </h2>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <article
              className={cn(
                "flex flex-col gap-3 rounded-xl border border-florisyn-border/60 bg-florisyn-cream/50 p-4 motion-safe-transition",
                "sm:flex-row sm:items-center sm:justify-between dark:bg-florisyn-sage-50/30",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-florisyn-ink">{item.title}</h3>
                  {item.priority === "rush" ? (
                    <span className="rounded-md bg-florisyn-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Rush
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-florisyn-muted">{item.customer}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
                <time className="text-sm font-medium tabular-nums text-florisyn-ink">
                  {item.dueTime}
                </time>
                <span
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium",
                    statusStyle[item.status],
                  )}
                >
                  {statusLabel[item.status]}
                </span>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
