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
      <p id="daily-insight-title" className="text-label">
        Holiday preparation
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-charcoal-muted">{message}</p>
    </SurfaceCard>
  );
}
