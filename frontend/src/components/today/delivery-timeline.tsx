import { cn } from "../../lib/utils";
import {
  deliveryStatusLabel,
  type DeliveryScheduleStop,
} from "../../lib/today-sample";
import { SurfaceCard } from "../ui/surface-card";

const statusStyles: Record<DeliveryScheduleStop["status"], string> = {
  scheduled: "bg-charcoal-subtle",
  "en-route": "bg-blush-500 motion-safe:animate-pulse motion-reduce:animate-none",
  delivered: "bg-sage-muted",
};

export type DeliveryTimelineProps = {
  stops: DeliveryScheduleStop[];
  className?: string;
};

export function DeliveryTimeline({ stops, className }: DeliveryTimelineProps) {
  return (
    <SurfaceCard as="section" className={className} aria-labelledby="delivery-schedule-title">
      <h2
        id="delivery-schedule-title"
        className="font-serif-display text-xl font-semibold text-charcoal md:text-2xl"
      >
        Delivery schedule
      </h2>
      <ol className="mt-6 space-y-0">
        {stops.map((stop, index) => (
          <li
            key={stop.id}
            className={cn(
              "relative border-l border-florisyn-border pl-6",
              index < stops.length - 1 ? "pb-8" : "pb-0",
            )}
          >
            <span
              className={cn(
                "absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-warm-white",
                statusStyles[stop.status],
              )}
              aria-hidden
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <time className="text-xs font-semibold uppercase tracking-wide text-charcoal-subtle">
                  {stop.time}
                </time>
                <p className="mt-1 font-medium text-charcoal">{stop.destination}</p>
                <p className="text-sm text-charcoal-muted">Driver: {stop.driver}</p>
              </div>
              <span className="text-xs font-medium text-charcoal-muted">
                {deliveryStatusLabel[stop.status]}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </SurfaceCard>
  );
}
