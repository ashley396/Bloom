import { cn } from "../../lib/utils";
import {
  deliveryStatusLabel,
  type DeliveryScheduleStop,
} from "../../lib/today-sample";
import { SurfaceCard } from "../ui/surface-card";

const statusStyles: Record<DeliveryScheduleStop["status"], string> = {
  scheduled: "bg-sage-muted",
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
        className="font-serif-display text-2xl font-medium text-charcoal md:text-[1.75rem]"
      >
        Delivery schedule
      </h2>
      <ol className="mt-8 space-y-0">
        {stops.map((stop, index) => (
          <li
            key={stop.id}
            className={cn(
              "relative border-l border-sage-soft pl-7",
              index < stops.length - 1 ? "pb-9" : "pb-0",
            )}
          >
            <span
              className={cn(
                "absolute -left-[5px] top-2 size-2.5 rounded-full ring-4 ring-warm-white",
                statusStyles[stop.status],
              )}
              aria-hidden
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <time className="text-label">{stop.time}</time>
                <p className="mt-2 font-medium text-charcoal">{stop.destination}</p>
                <p className="mt-1 text-sm text-charcoal-muted">Driver: {stop.driver}</p>
              </div>
              <span className="text-sm font-medium text-sage-ink">
                {deliveryStatusLabel[stop.status]}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </SurfaceCard>
  );
}
