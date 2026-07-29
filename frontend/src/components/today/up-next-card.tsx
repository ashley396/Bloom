import { PhotoAsset } from "../../lib/floral-asset-library";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";
import type { UpNextOrder } from "../../lib/today-sample";
import { cn } from "../../lib/utils";

export type UpNextCardProps = {
  order: UpNextOrder;
  className?: string;
};

export function UpNextCard({ order, className }: UpNextCardProps) {
  return (
    <SurfaceCard
      as="section"
      className={cn(
        "overflow-hidden ring-blush-100/80 shadow-elevated",
        className,
      )}
      aria-labelledby="up-next-heading"
      padding="none"
      interactive
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_min(42%,280px)] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col justify-between gap-8 p-8 lg:p-10 xl:p-12">
          <div>
            <p className="text-label text-blush-600">Up next</p>
            <h2
              id="up-next-heading"
              className="font-serif-display mt-3 text-3xl font-medium text-charcoal md:text-4xl"
            >
              {order.customer}
            </h2>
            <p className="mt-3 text-lg text-charcoal-muted">{order.title}</p>
            <dl className="mt-6 space-y-2 text-[15px]">
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-sage-ink">Due</dt>
                <dd className="font-medium text-charcoal">{order.dueTime}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-sage-ink">Delivery</dt>
                <dd className="text-charcoal-muted">{order.deliveryNote}</dd>
              </div>
            </dl>
          </div>
          <Button type="button" size="lg" className="w-full sm:w-auto sm:min-w-[200px]">
            Start Designing
          </Button>
        </div>
        <div className="relative min-h-[220px] border-t border-florisyn-border lg:min-h-[280px] lg:border-l lg:border-t-0">
          <PhotoAsset
            photoId={order.photoId}
            pageSlot={order.photoSlot}
            alt={`Reference photo for ${order.customer}`}
            aspect="auto"
            className="absolute inset-0 h-full w-full rounded-none lg:rounded-none lg:rounded-r-2xl"
          />
        </div>
      </div>
    </SurfaceCard>
  );
}
