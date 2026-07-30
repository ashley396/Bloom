import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";

export type LilyRecommendationProps = {
  message: string;
  primaryAction: string;
  dismissAction: string;
  className?: string;
};

/** Lily AI — Creative Director. Warm, elegant, never robotic. */
export function LilyRecommendation({
  message,
  primaryAction,
  dismissAction,
  className,
}: LilyRecommendationProps) {
  return (
    <SurfaceCard
      as="section"
      className={cn(
        "bg-gradient-to-br from-hydrangea-pale/50 via-warm-white to-blush-50/30 ring-hydrangea-soft/30",
        className,
      )}
      aria-labelledby="lily-rec-heading"
    >
      <div className="flex items-start gap-4">
        <span
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blush-50 ring-1 ring-blush-100"
          aria-hidden
        >
          <img
            src="/assets/assistants/lily-portrait.svg"
            alt=""
            className="size-10 object-contain"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="lily-rec-heading" className="text-label text-blush-600">
            Lily · Creative Director
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
        </div>
      </div>
    </SurfaceCard>
  );
}
