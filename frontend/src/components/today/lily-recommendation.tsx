import { Sparkles } from "lucide-react";
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
      className={cn("bg-hydrangea-pale/40 ring-hydrangea-soft/50", className)}
      aria-labelledby="lily-rec-heading"
    >
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-blush-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="lily-rec-heading" className="text-sm font-semibold text-charcoal">
            Lily Assistant
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-charcoal-muted md:text-[15px]">
            {message}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" size="sm">
              {primaryAction}
            </Button>
            <Button type="button" variant="ghost" size="sm">
              {dismissAction}
            </Button>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
