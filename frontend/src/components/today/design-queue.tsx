import { PhotoAsset } from "../media/PhotoAsset";
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
    dot: "bg-charcoal-subtle",
  },
  ready: {
    pill: "bg-sage-pale text-charcoal",
    dot: "bg-sage-muted",
  },
  delivered: {
    pill: "bg-sage-soft/50 text-charcoal-muted",
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
    <article className="flex gap-4 rounded-xl bg-warm-cream/60 p-4 ring-1 ring-florisyn-border/80">
      <PhotoAsset
        src={order.photoSrc}
        alt={`Reference for ${order.customerOrRecipient}`}
        aspect="square"
        className="size-16 shrink-0 rounded-lg sm:size-[4.5rem]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-charcoal">{order.customerOrRecipient}</h3>
          <p className="text-sm text-charcoal-muted">{order.occasion}</p>
          <p className="mt-1 text-xs text-charcoal-subtle">
            Due <time>{order.dueTime}</time>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <span className="font-medium tabular-nums text-charcoal">{order.price}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium",
              styles.pill,
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", styles.dot)}
              aria-hidden
            />
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
        className="font-serif-display text-xl font-semibold text-charcoal md:text-2xl"
      >
        Today&apos;s design queue
      </h2>
      <p className="mt-1 text-sm text-charcoal-muted">
        Orders on the bench — calm, scannable, never spreadsheet-dense.
      </p>
      <ul className="mt-6 space-y-3">
        {orders.map((order) => (
          <li key={order.id}>
            <DesignQueueItem order={order} />
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
