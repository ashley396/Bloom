import { Sparkles } from "lucide-react";
import { PhotoAsset } from "../media/PhotoAsset";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";

export type LilyInsightCardProps = {
  headline: string;
  body: string;
  cta: string;
  className?: string;
};

export function LilyInsightCard({
  headline,
  body,
  cta,
  className,
}: LilyInsightCardProps) {
  return (
    <SurfaceCard
      className={className}
      as="section"
      padding="none"
      aria-labelledby="lily-insight-title"
    >
      <div className="grid md:grid-cols-5">
        <div className="relative min-h-[140px] md:col-span-2 md:min-h-full">
          <PhotoAsset
            src={null}
            alt="Professional floral workspace photography"
            aspect="auto"
            className="h-full min-h-[140px] rounded-none rounded-t-2xl md:rounded-l-2xl md:rounded-tr-none"
            priority={false}
          />
        </div>
        <div className="flex flex-col justify-between gap-6 p-6 md:col-span-3 md:p-8">
          <div>
            <div className="flex items-center gap-2 text-florisyn-sage-700 dark:text-florisyn-sage-500">
              <Sparkles className="size-4" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide">Lily</span>
            </div>
            <h2
              id="lily-insight-title"
              className="font-display mt-3 text-xl font-semibold tracking-tight text-florisyn-ink md:text-2xl"
            >
              {headline}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-florisyn-muted md:text-[15px]">
              {body}
            </p>
          </div>
          <Button type="button" className="w-fit">
            {cta}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
