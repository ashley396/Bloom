import { SurfaceCard } from "../ui/surface-card";

export type DailyInsightProps = {
  message: string;
  className?: string;
};

export function DailyInsight({ message, className }: DailyInsightProps) {
  return (
    <SurfaceCard
      as="aside"
      className={className}
      padding="md"
      aria-labelledby="daily-insight-title"
    >
      <p id="daily-insight-title" className="text-xs font-semibold uppercase tracking-wide text-charcoal-subtle">
        Holiday preparation
      </p>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-muted md:text-[15px]">{message}</p>
    </SurfaceCard>
  );
}
