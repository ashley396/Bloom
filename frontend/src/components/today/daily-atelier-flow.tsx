import {
  Calendar,
  CreditCard,
  Globe,
  Package,
  Phone,
  Truck,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { SurfaceCard } from "../ui/surface-card";

export type AtelierItemType =
  | "delivery"
  | "appointment"
  | "order"
  | "call"
  | "website"
  | "payment";

export type AtelierTimelineItem = {
  id: string;
  time: string;
  type: AtelierItemType;
  title: string;
  subtitle?: string;
  status?: "upcoming" | "active" | "complete";
};

const typeConfig: Record<
  AtelierItemType,
  { icon: typeof Truck; label: string; accent: string }
> = {
  delivery: {
    icon: Truck,
    label: "Delivery",
    accent: "bg-sage-pale text-sage-ink ring-sage-soft",
  },
  appointment: {
    icon: Calendar,
    label: "Appointment",
    accent: "bg-hydrangea-pale text-charcoal-muted ring-hydrangea-soft",
  },
  order: {
    icon: Package,
    label: "Order",
    accent: "bg-blush-50 text-charcoal ring-blush-100",
  },
  call: {
    icon: Phone,
    label: "Call",
    accent: "bg-linen text-charcoal-muted ring-stone/30",
  },
  website: {
    icon: Globe,
    label: "Website order",
    accent: "bg-champagne-pale text-charcoal ring-champagne-gold/20",
  },
  payment: {
    icon: CreditCard,
    label: "Payment",
    accent: "bg-terracotta-pale text-terracotta ring-terracotta/20",
  },
};

const statusDot: Record<
  NonNullable<AtelierTimelineItem["status"]>,
  string
> = {
  upcoming: "bg-stone",
  active: "bg-champagne-gold animate-pulse motion-reduce:animate-none",
  complete: "bg-sage-muted",
};

export type DailyAtelierFlowProps = {
  items: AtelierTimelineItem[];
  className?: string;
};

export function DailyAtelierFlow({ items, className }: DailyAtelierFlowProps) {
  return (
    <SurfaceCard
      as="section"
      className={className}
      aria-labelledby="atelier-flow-title"
    >
      <h2
        id="atelier-flow-title"
        className="font-serif-display text-2xl font-medium text-charcoal md:text-[1.75rem]"
      >
        Daily atelier flow
      </h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-charcoal-muted">
        Your production day — curated like a luxury schedule, not a task list.
      </p>

      <ol className="relative mt-10 space-y-0">
        <div
          className="absolute bottom-4 left-[1.375rem] top-4 w-px bg-gradient-to-b from-champagne-gold/30 via-stone/20 to-transparent"
          aria-hidden
        />
        {items.map((item, index) => {
          const config = typeConfig[item.type];
          const Icon = config.icon;
          const status = item.status ?? "upcoming";

          return (
            <li
              key={item.id}
              className={cn(
                "relative flex gap-5 pb-8 last:pb-0",
                "motion-safe:animate-[fade-in_0.5s_ease-out_both]",
              )}
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className="relative z-10 flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl ring-1",
                    config.accent,
                  )}
                >
                  <Icon className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
                </span>
                {item.status ? (
                  <span
                    className={cn("mt-2 size-2 rounded-full", statusDot[status])}
                    aria-hidden
                  />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pt-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time className="text-sm font-semibold tabular-nums text-charcoal">
                    {item.time}
                  </time>
                  <span className="text-label text-sage-ink">{config.label}</span>
                </div>
                <p className="mt-1.5 font-medium text-charcoal">{item.title}</p>
                {item.subtitle ? (
                  <p className="mt-0.5 text-sm text-charcoal-muted">{item.subtitle}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </SurfaceCard>
  );
}
