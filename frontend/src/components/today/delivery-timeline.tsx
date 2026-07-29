import type { DeliveryStop } from "../../lib/today-data";
import { cn } from "../../lib/utils";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

const dotStyle: Record<DeliveryStop["status"], string> = {
  delivered: "bg-florisyn-sage-500 ring-florisyn-sage-100",
  "en-route": "bg-amber-500 ring-amber-100 animate-pulse motion-reduce:animate-none",
  scheduled: "bg-florisyn-border ring-florisyn-sage-50",
};

type DeliveryTimelineProps = {
  stops: DeliveryStop[];
  className?: string;
};

export function DeliveryTimeline({ stops, className }: DeliveryTimelineProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="delivery-heading">
      <SectionHeader
        title="Delivery timeline"
        description="Today's route at a glance — times, recipients, and status."
      />
      <h2 id="delivery-heading" className="sr-only">
        Delivery timeline
      </h2>
      <ol className="relative space-y-0 border-l border-florisyn-border/80 pl-6">
        {stops.map((stop, index) => (
          <li key={stop.id} className={cn("relative pb-8 last:pb-0")}>
            <span
              className={cn(
                "absolute -left-[calc(0.375rem+1px)] top-1.5 size-3 rounded-full ring-4",
                dotStyle[stop.status],
              )}
              aria-hidden
            />
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <time className="text-xs font-semibold uppercase tracking-wide text-florisyn-muted">
                  {stop.time}
                </time>
                <p className="mt-1 font-medium text-florisyn-ink">{stop.recipient}</p>
                <p className="text-sm text-florisyn-muted">{stop.address}</p>
              </div>
              <p className="text-xs font-medium capitalize text-florisyn-sage-700 dark:text-florisyn-sage-500">
                {stop.status.replace("-", " ")}
              </p>
            </div>
            {index < stops.length - 1 ? (
              <span className="sr-only">Next stop</span>
            ) : null}
          </li>
        ))}
      </ol>
    </SurfaceCard>
  );
}
