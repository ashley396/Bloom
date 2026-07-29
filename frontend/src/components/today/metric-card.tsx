import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { SurfaceCard } from "../ui/surface-card";

export type MetricCardProps = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  className?: string;
};

export function MetricCard({ label, value, icon: Icon, className }: MetricCardProps) {
  return (
    <SurfaceCard
      as="article"
      className={cn("flex flex-col gap-3", className)}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-subtle">
          {label}
        </p>
        <span className="flex size-9 items-center justify-center rounded-lg bg-hydrangea-pale text-charcoal-muted">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="font-serif-display text-3xl font-semibold tabular-nums text-charcoal md:text-[2rem]">
        {value}
      </p>
    </SurfaceCard>
  );
}
