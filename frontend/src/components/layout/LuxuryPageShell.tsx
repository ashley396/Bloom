import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { SurfaceCard } from "../ui/surface-card";

export type LuxuryPageShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Shared luxury page chrome for React preview routes. */
export function LuxuryPageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: LuxuryPageShellProps) {
  return (
    <div className={cn("mx-auto max-w-6xl space-y-10 lg:space-y-12", className)}>
      <header className="animate-fade-in flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-label text-champagne-gold">{eyebrow}</p>
          <h1 className="font-serif-display text-3xl font-medium text-charcoal md:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-[15px] leading-relaxed text-charcoal-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export type LuxuryMetricProps = {
  label: string;
  value: string;
  className?: string;
};

export function LuxuryMetric({ label, value, className }: LuxuryMetricProps) {
  return (
    <SurfaceCard as="article" className={className} interactive>
      <p className="text-label">{label}</p>
      <p className="mt-3 font-serif-display text-3xl font-medium tabular-nums text-charcoal">
        {value}
      </p>
    </SurfaceCard>
  );
}

export type LuxuryEmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function LuxuryEmptyState({ title, description, action }: LuxuryEmptyStateProps) {
  return (
    <SurfaceCard className="py-16 text-center" padding="lg">
      <p className="font-serif-display text-2xl font-medium text-charcoal">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-charcoal-muted">{description}</p>
      {action ? <div className="mt-8">{action}</div> : null}
    </SurfaceCard>
  );
}
