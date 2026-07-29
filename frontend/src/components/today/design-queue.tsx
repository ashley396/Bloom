import { PhotoAsset } from "../../lib/floral-asset-library";
import { SurfaceCard } from "../ui/surface-card";
import { cn } from "../../lib/utils";
import {
  designQueueStatusLabel,
  type DesignQueueOrder,
} from "../../lib/today-sample";

const statusStyles: Record<
  DesignQueueOrder["status"],
  { pill: string; dot: string }
> = {
  designing: {
    pill: "bg-hydrangea-pale text-charcoal",
    dot: "bg-blush-500",
  },
  waiting: {
    pill: "bg-warm-cream-deep text-charcoal-muted",
    dot: "bg-sage-muted",
  },
  ready: {
    pill: "bg-sage-pale text-charcoal",
    dot: "bg-sage-muted",
  },
  delivered: {
    pill: "bg-sage-soft/60 text-charcoal-muted",
    dot: "bg-sage-muted",
  },
};

export type DesignQueueItemProps = {
  order: DesignQueueOrder;
};

export function DesignQueueItem({ order }: DesignQueueItemProps) {
  const styles = statusStyles[order.status];
  const statusText = designQueueStatusLabel[order.status];

  return (
    <article className="surface-lift flex gap-5 rounded-2xl bg-warm-cream/50 p-5 ring-1 ring-florisyn-border/90">
      <PhotoAsset
        photoId={order.photoId}
        pageSlot={order.photoSlot}
        alt={`Reference for ${order.customerOrRecipient}`}
        aspect="square"
        className="size-[4.25rem] shrink-0 rounded-xl sm:size-[4.75rem]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium text-charcoal">
            {order.customerOrRecipient}
          </h3>
          <p className="mt-0.5 text-sm text-charcoal-muted">{order.occasion}</p>
          <p className="mt-1.5 text-xs text-sage-ink">
            Due <time>{order.dueTime}</time>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <span className="font-medium tabular-nums text-charcoal">{order.price}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium",
              styles.pill,
            )}
          >
            <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
            {statusText}
          </span>
        </div>
      </div>
    </article>
  );
}

export type DesignQueueProps = {
  orders: DesignQueueOrder[];
  className?: string;
};

export function DesignQueue({ orders, className }: DesignQueueProps) {
  return (
    <SurfaceCard as="section" className={className} aria-labelledby="design-queue-title">
      <h2
        id="design-queue-title"
        className="font-serif-display text-2xl font-medium text-charcoal md:text-[1.75rem]"
      >
        Today&apos;s design queue
      </h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-charcoal-muted">
        Orders on the bench — calm, scannable, never spreadsheet-dense.
      </p>
      <ul className="mt-8 space-y-4">
        {orders.map((order) => (
          <li key={order.id}>
            <DesignQueueItem order={order} />
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
