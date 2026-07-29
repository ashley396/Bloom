import { PhotoAsset } from "../../lib/floral-asset-library";
import { cn } from "../../lib/utils";
import type { FloristOrder } from "../../lib/orders-sample";
import { OrderStatusBadge } from "./order-status-badge";

export type OrderCardProps = {
  order: FloristOrder;
  selected: boolean;
  onSelect: () => void;
};

export function OrderCard({ order, selected, onSelect }: OrderCardProps) {
  const showListPhoto = !selected;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "surface-lift w-full rounded-2xl bg-warm-white p-5 text-left shadow-card ring-1 motion-safe-transition",
        selected
          ? "ring-2 ring-blush-400/90 shadow-elevated"
          : "ring-florisyn-border hover:ring-blush-100/80",
      )}
      aria-pressed={selected}
      aria-label={`Order ${order.orderNumber}, ${order.recipient}`}
    >
      <div className="flex gap-5">
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-xl bg-warm-cream-deep",
            showListPhoto ? "size-[5.5rem] sm:size-24" : "size-[5.5rem] sm:size-24",
          )}
        >
          {showListPhoto ? (
            <PhotoAsset
              photoId={order.photoId}
              pageSlot={order.photoSlot}
              alt={`Arrangement for ${order.recipient}`}
              aspect="square"
              className="size-full rounded-xl"
            />
          ) : (
            <div
              className="flex size-full items-center justify-center text-xs font-medium text-sage-ink"
              aria-hidden
            >
              Open
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-label text-sage-ink">#{order.orderNumber}</p>
              <h3 className="font-serif-display mt-1 text-xl font-medium text-charcoal">
                {order.recipient}
              </h3>
              <p className="mt-0.5 text-sm text-charcoal-muted">
                {order.customer} · {order.occasion}
              </p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-sage-ink">Delivery</dt>
              <dd className="font-medium text-charcoal">
                {order.deliveryDate} · {order.deliveryTime}
              </dd>
            </div>
            <div>
              <dt className="text-sage-ink">Price</dt>
              <dd className="font-medium tabular-nums text-charcoal">{order.price}</dd>
            </div>
            <div>
              <dt className="text-sage-ink">Designer</dt>
              <dd className="text-charcoal-muted">{order.designer}</dd>
            </div>
            <div>
              <dt className="text-sage-ink">Driver</dt>
              <dd className="text-charcoal-muted">{order.driver}</dd>
            </div>
          </dl>
        </div>
      </div>
    </button>
  );
}
