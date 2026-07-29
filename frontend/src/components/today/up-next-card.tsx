import { PhotoAsset } from "../media/PhotoAsset";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";
import type { UpNextOrder } from "../../lib/today-sample";

export type UpNextCardProps = {
  order: UpNextOrder;
  className?: string;
};

export function UpNextCard({ order, className }: UpNextCardProps) {
  return (
    <SurfaceCard
      as="section"
      className={className}
      aria-labelledby="up-next-heading"
      padding="none"
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_140px] lg:grid-cols-[minmax(0,1fr)_160px]">
        <div className="flex flex-col justify-between gap-6 p-6 lg:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blush-600">
              Up next
            </p>
            <h2
              id="up-next-heading"
              className="font-serif-display mt-2 text-2xl font-semibold text-charcoal md:text-3xl"
            >
              {order.customer}
            </h2>
            <p className="mt-2 text-base text-charcoal-muted">{order.title}</p>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-charcoal-subtle">Due</dt>
                <dd className="font-medium text-charcoal">{order.dueTime}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-charcoal-subtle">Delivery</dt>
                <dd className="text-charcoal-muted">{order.deliveryNote}</dd>
              </div>
            </dl>
          </div>
          <Button type="button" size="lg" className="w-full sm:w-auto">
            Start Designing
          </Button>
        </div>
        <div className="border-t border-florisyn-border md:border-l md:border-t-0">
          <PhotoAsset
            src={order.photoSrc}
            alt={`Reference photo for ${order.customer}`}
            aspect="square"
            className="h-full min-h-[140px] rounded-none rounded-b-2xl md:rounded-bl-none md:rounded-r-2xl"
          />
        </div>
      </div>
    </SurfaceCard>
  );
}
