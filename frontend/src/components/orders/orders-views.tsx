import { cn } from "../../lib/utils";
import type { FloristOrder } from "../../lib/orders-sample";
import { OrderStatusBadge } from "./order-status-badge";
import { PhotoAsset } from "../../lib/floral-asset-library";

export type OrdersViewMode = "kanban" | "timeline" | "calendar" | "list";

const KANBAN_COLUMNS: { id: FloristOrder["status"] | "pending"; label: string; statuses: FloristOrder["status"][] }[] = [
  { id: "pending", label: "Pending", statuses: ["pending"] },
  { id: "designing", label: "Designing", statuses: ["designing"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "out-for-delivery", label: "Out", statuses: ["out-for-delivery"] },
  { id: "delivered", label: "Delivered", statuses: ["delivered"] },
];

export function OrdersViewSwitcher({
  view,
  onChange,
  className,
}: {
  view: OrdersViewMode;
  onChange: (view: OrdersViewMode) => void;
  className?: string;
}) {
  const modes: { id: OrdersViewMode; label: string }[] = [
    { id: "kanban", label: "Kanban" },
    { id: "timeline", label: "Timeline" },
    { id: "calendar", label: "Calendar" },
    { id: "list", label: "List" },
  ];

  return (
    <div
      className={cn(
        "inline-flex rounded-full bg-warm-cream-deep p-1 ring-1 ring-florisyn-border",
        className,
      )}
      role="tablist"
      aria-label="Orders view"
    >
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={view === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            "min-h-11 rounded-full px-4 text-sm font-medium motion-safe-transition",
            view === m.id
              ? "bg-warm-white text-charcoal shadow-card"
              : "text-charcoal-muted hover:text-charcoal",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function KanbanCard({
  order,
  selected,
  onSelect,
}: {
  order: FloristOrder;
  selected: boolean;
  onSelect: () => void;
}) {
  const urgent = /rush|vip/i.test(order.customerNotes) || order.paymentStatus === "unpaid";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-warm-white to-ivory p-4 text-left shadow-card ring-1 motion-safe-transition",
        urgent ? "ring-terracotta/30" : "ring-florisyn-border",
        selected && "ring-2 ring-sage/40 shadow-elevated",
      )}
    >
      <div className="flex gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-warm-cream-deep">
          <PhotoAsset
            photoId={order.photoId}
            pageSlot={order.photoSlot}
            alt=""
            aspect="square"
            className="size-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif-display text-lg font-medium text-charcoal">{order.customer}</p>
          <p className="text-xs text-charcoal-muted">
            #{order.orderNumber} · {order.occasion}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-warm-cream-deep px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal-muted">
              {order.deliveryTime}
            </span>
            {order.paymentStatus === "unpaid" ? (
              <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-terracotta">
                Unpaid
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs text-charcoal-muted">{order.designerNotes || order.customerNotes}</p>
      <div className="mt-3 flex items-center justify-between border-t border-florisyn-border/60 pt-2">
        <OrderStatusBadge status={order.status} />
        <span className="font-serif-display text-base font-medium tabular-nums text-charcoal">{order.price}</span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-1 bg-gradient-to-t from-warm-white via-warm-white/95 to-transparent p-3 pt-8 opacity-0 motion-safe-transition group-hover:opacity-100 group-focus-within:opacity-100">
        <span className="rounded-full bg-warm-white px-2.5 py-1 text-[10px] font-semibold shadow-card ring-1 ring-florisyn-border">
          Edit
        </span>
        <span className="rounded-full bg-warm-white px-2.5 py-1 text-[10px] font-semibold shadow-card ring-1 ring-florisyn-border">
          Print
        </span>
        <span className="rounded-full bg-warm-white px-2.5 py-1 text-[10px] font-semibold shadow-card ring-1 ring-florisyn-border">
          Ready
        </span>
      </div>
    </button>
  );
}

export function OrdersKanbanBoard({
  orders,
  selectedId,
  onSelect,
}: {
  orders: FloristOrder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
      {KANBAN_COLUMNS.map((col) => {
        const items = orders.filter((o) => col.statuses.includes(o.status));
        return (
          <section
            key={col.id}
            className="min-w-[260px] flex-shrink-0 snap-start rounded-2xl bg-warm-cream-deep/80 p-4 ring-1 ring-florisyn-border"
          >
            <header className="mb-4 flex items-baseline justify-between border-b border-florisyn-border pb-3">
              <h3 className="text-label text-sage-ink">{col.label}</h3>
              <span className="rounded-full bg-warm-white px-2 py-0.5 text-xs font-bold text-charcoal ring-1 ring-florisyn-border">
                {items.length}
              </span>
            </header>
            <ul className="space-y-3">
              {items.map((order) => (
                <li key={order.id}>
                  <KanbanCard
                    order={order}
                    selected={selectedId === order.id}
                    onSelect={() => onSelect(order.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function OrdersTimelineView({
  orders,
  onSelect,
}: {
  orders: FloristOrder[];
  onSelect: (id: string) => void;
}) {
  const byDay = orders.reduce<Record<string, FloristOrder[]>>((acc, o) => {
    (acc[o.deliveryDate] ||= []).push(o);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {Object.entries(byDay).map(([day, items]) => (
        <section key={day}>
          <h3 className="font-serif-display border-b border-florisyn-border pb-2 text-xl font-medium text-charcoal">
            {day}
          </h3>
          <ul className="mt-4 space-y-3 border-l-2 border-champagne pl-6">
            {items.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => onSelect(order.id)}
                  className="grid w-full grid-cols-[72px_1fr_auto] gap-4 rounded-2xl bg-warm-white p-4 text-left shadow-card ring-1 ring-florisyn-border motion-safe-transition hover:shadow-elevated"
                >
                  <span className="text-sm font-semibold text-charcoal-muted">{order.deliveryTime}</span>
                  <span>
                    <strong className="font-serif-display text-base text-charcoal">{order.customer}</strong>
                    <p className="text-sm text-charcoal-muted">
                      {order.occasion} · {order.designer}
                    </p>
                  </span>
                  <span className="font-serif-display font-medium tabular-nums text-charcoal">{order.price}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
