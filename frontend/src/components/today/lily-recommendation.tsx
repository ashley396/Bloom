import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";

export type LilyRecommendationProps = {
  message: string;
  primaryAction: string;
  dismissAction: string;
  className?: string;
};

export function LilyRecommendation({
  message,
  primaryAction,
  dismissAction,
  className,
}: LilyRecommendationProps) {
  return (
    <SurfaceCard
      as="section"
      className={cn("bg-hydrangea-pale/35 ring-hydrangea-soft/40", className)}
      aria-labelledby="lily-rec-heading"
    >
      <h2 id="lily-rec-heading" className="text-label text-charcoal">
        Lily Assistant
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-charcoal-muted">{message}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="sm">
          {primaryAction}
        </Button>
        <Button type="button" variant="ghost" size="sm">
          {dismissAction}
        </Button>
      </div>
    </SurfaceCard>
  );
}
