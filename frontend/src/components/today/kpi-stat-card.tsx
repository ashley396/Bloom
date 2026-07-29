import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { SurfaceCard } from "../ui/surface-card";

export type KpiStatCardProps = {
  label: string;
  value: string;
  detail?: string;
  trend?: { direction: "up" | "down" | "neutral"; label: string };
  icon: LucideIcon;
  className?: string;
};

export function KpiStatCard({
  label,
  value,
  detail,
  trend,
  icon: Icon,
  className,
}: KpiStatCardProps) {
  return (
    <SurfaceCard
      hover
      className={cn("flex flex-col gap-4", className)}
      as="article"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium uppercase tracking-wide text-florisyn-muted">
          {label}
        </p>
        <span className="flex size-10 items-center justify-center rounded-xl bg-florisyn-sage-50 text-florisyn-sage-700 dark:bg-florisyn-sage-100/80 dark:text-florisyn-sage-500">
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      <div>
        <p className="font-display text-3xl font-semibold tracking-tight text-florisyn-ink md:text-[2rem]">
          {value}
        </p>
        {detail ? (
          <p className="mt-1 text-sm text-florisyn-muted">{detail}</p>
        ) : null}
        {trend ? (
          <p
            className={cn(
              "mt-2 text-xs font-medium",
              trend.direction === "up" && "text-florisyn-sage-700 dark:text-florisyn-sage-500",
              trend.direction === "down" && "text-amber-800 dark:text-amber-200/90",
              trend.direction === "neutral" && "text-florisyn-muted",
            )}
          >
            {trend.label}
          </p>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
