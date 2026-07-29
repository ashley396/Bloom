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
      className={cn("flex flex-col gap-4", className)}
      aria-label={`${label}: ${value}`}
      interactive
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-label">{label}</p>
        <Icon className="size-[18px] shrink-0 text-sage-muted" strokeWidth={1.75} aria-hidden />
      </div>
      <p className="font-serif-display text-[2.125rem] font-medium leading-none tabular-nums text-charcoal md:text-[2.375rem]">
        {value}
      </p>
    </SurfaceCard>
  );
}
