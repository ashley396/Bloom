import { cn } from "../../lib/utils";
import type { OrderStatus } from "../../lib/orders-sample";
import { orderStatusLabel } from "../../lib/orders-sample";

const statusStyles: Record<
  OrderStatus,
  { pill: string; dot: string }
> = {
  pending: {
    pill: "bg-warm-cream-deep text-charcoal-muted",
    dot: "bg-sage-muted",
  },
  designing: {
    pill: "bg-hydrangea-pale text-charcoal",
    dot: "bg-blush-500",
  },
  ready: {
    pill: "bg-sage-pale text-charcoal",
    dot: "bg-sage-muted",
  },
  "out-for-delivery": {
    pill: "bg-blush-50 text-charcoal",
    dot: "bg-blush-500",
  },
  delivered: {
    pill: "bg-sage-soft/70 text-charcoal-muted",
    dot: "bg-sage-muted",
  },
  cancelled: {
    pill: "bg-warm-cream-deep text-sage-ink line-through decoration-sage-muted/50",
    dot: "bg-charcoal-subtle",
  },
};

export type OrderStatusBadgeProps = {
  status: OrderStatus;
  className?: string;
};

export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps) {
  const styles = statusStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium",
        styles.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {orderStatusLabel[status]}
    </span>
  );
}
