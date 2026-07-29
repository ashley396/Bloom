import { useState } from "react";
import {
  Copy,
  CreditCard,
  MapPin,
  MessageSquare,
  Pencil,
  Printer,
  Receipt,
} from "lucide-react";
import { Button } from "../ui/button";
import { PhotoAsset, type FloralAssetId } from "../../lib/floral-asset-library";
import { cn } from "../../lib/utils";
import type { FloristOrder } from "../../lib/orders-sample";
import { OrderStatusBadge } from "./order-status-badge";

type DetailTab = "overview" | "designer" | "delivery";

export type OrderDetailPanelProps = {
  order: FloristOrder | null;
  className?: string;
  onClose?: () => void;
};

export function OrderDetailPanel({ order, className, onClose }: OrderDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("overview");

  if (!order) {
    return (
      <aside
        className={cn(
          "hidden rounded-2xl bg-warm-white p-8 shadow-card ring-1 ring-florisyn-border xl:flex xl:flex-col xl:items-center xl:justify-center xl:text-center",
          className,
        )}
        aria-label="Order details"
      >
        <p className="font-serif-display text-2xl font-medium text-charcoal">
          Select an order
        </p>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-charcoal-muted">
          Your workspace opens here — recipe, delivery, and every detail of the
          arrangement.
        </p>
      </aside>
    );
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "designer", label: "Designer" },
    { id: "delivery", label: "Delivery" },
  ];

  return (
    <aside
      className={cn(
        "flex max-h-[calc(100svh-8rem)] flex-col overflow-hidden rounded-2xl bg-warm-white shadow-card ring-1 ring-florisyn-border motion-safe:animate-[fade-in_0.35s_ease-out_both] motion-reduce:animate-none",
        className,
      )}
      aria-label={`Order ${order.orderNumber} details`}
    >
      <div className="border-b border-florisyn-border p-6 lg:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-label">Order #{order.orderNumber}</p>
            <h2 className="font-serif-display mt-2 text-2xl font-medium text-charcoal">
              {order.recipient}
            </h2>
            <p className="mt-1 text-sm text-charcoal-muted">{order.recipeName}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className="mt-5 flex gap-1 rounded-2xl bg-warm-cream/80 p-1 ring-1 ring-florisyn-border/80">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "min-h-[44px] flex-1 rounded-xl px-3 text-sm font-medium motion-safe-transition",
                tab === id
                  ? "bg-warm-white text-charcoal shadow-sm"
                  : "text-charcoal-muted hover:text-charcoal",
              )}
              aria-selected={tab === id}
              role="tab"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 lg:p-7">
        {tab === "overview" ? (
          <OverviewTab order={order} photoId={order.photoId} />
        ) : null}
        {tab === "designer" ? <DesignerTab order={order} photoId={order.photoId} /> : null}
        {tab === "delivery" ? <DeliveryTab order={order} /> : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-florisyn-border p-6 lg:p-7">
        <Button type="button" size="sm" variant="secondary" className="gap-2">
          <Receipt className="size-[16px]" strokeWidth={1.75} aria-hidden />
          Invoice
        </Button>
        <Button type="button" size="sm" variant="secondary" className="gap-2">
          <Printer className="size-[16px]" strokeWidth={1.75} aria-hidden />
          Print card
        </Button>
        <Button type="button" size="sm" variant="secondary" className="gap-2">
          <Copy className="size-[16px]" strokeWidth={1.75} aria-hidden />
          Duplicate
        </Button>
        <Button type="button" size="sm" className="ml-auto gap-2">
          <Pencil className="size-[16px]" strokeWidth={1.75} aria-hidden />
          Edit
        </Button>
        {onClose ? (
          <Button type="button" size="sm" variant="ghost" className="xl:hidden" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function OverviewTab({
  order,
  photoId,
}: {
  order: FloristOrder;
  photoId: FloralAssetId;
}) {
  return (
    <div className="space-y-8">
      <PhotoAsset
        photoId={photoId}
        pageSlot="orders.detail.hero"
        alt={`${order.recipeName} arrangement`}
        aspect="video"
        className="rounded-2xl"
        priority
      />
      <section>
        <h3 className="text-label">Recipe</h3>
        <p className="font-serif-display mt-2 text-xl font-medium text-charcoal">
          {order.recipeName}
        </p>
        <ul className="mt-4 space-y-2">
          {order.stems.map((line) => (
            <li
              key={`${line.flower}-${line.count}`}
              className="flex justify-between text-[15px] text-charcoal-muted"
            >
              <span>{line.flower}</span>
              <span className="tabular-nums text-charcoal">{line.count} stems</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <DetailField label="Ribbon" value={order.ribbonColor} />
        <DetailField
          label="Payment"
          value={order.paymentStatus}
          icon={CreditCard}
        />
      </section>
      <section>
        <h3 className="text-label">Card message</h3>
        <p className="mt-2 rounded-2xl bg-warm-cream/60 p-4 text-[15px] italic leading-relaxed text-charcoal-muted ring-1 ring-florisyn-border/80">
          {order.cardMessage || "—"}
        </p>
      </section>
      <section>
        <h3 className="text-label">Delivery address</h3>
        <p className="mt-2 flex gap-2 text-[15px] text-charcoal-muted">
          <MapPin className="mt-0.5 size-[18px] shrink-0 text-sage-muted" strokeWidth={1.75} />
          {order.deliveryAddress}
        </p>
      </section>
      <section>
        <h3 className="text-label">Customer notes</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-charcoal-muted">
          {order.customerNotes || "—"}
        </p>
      </section>
    </div>
  );
}

function DesignerTab({
  order,
  photoId,
}: {
  order: FloristOrder;
  photoId: FloralAssetId;
}) {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <PhotoAsset
          photoId={photoId}
          pageSlot="orders.detail.hero"
          alt="Design reference"
          aspect="square"
          className="rounded-2xl lg:min-h-[280px]"
        />
        <div>
          <h3 className="text-label">Recipe · stem counts</h3>
          <ul className="mt-4 space-y-3">
            {order.stems.map((line) => (
              <li
                key={`design-${line.flower}`}
                className="rounded-2xl bg-warm-cream/50 px-4 py-3 ring-1 ring-florisyn-border/80"
              >
                <div className="flex justify-between font-medium text-charcoal">
                  <span>{line.flower}</span>
                  <span className="tabular-nums">{line.count}</span>
                </div>
                {line.substitution ? (
                  <p className="mt-1 text-sm text-blush-600">
                    Substitute: {line.substitution}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section>
        <h3 className="text-label">Completion checklist</h3>
        <ul className="mt-4 space-y-2">
          {order.checklist.map((item) => (
            <li
              key={item.id}
              className="flex min-h-[44px] items-center gap-3 rounded-xl bg-sage-pale/50 px-4 py-2 text-[15px]"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md ring-1",
                  item.done
                    ? "bg-sage-muted text-warm-white ring-sage-muted"
                    : "bg-warm-white ring-florisyn-border",
                )}
                aria-hidden
              >
                {item.done ? "✓" : ""}
              </span>
              <span className={item.done ? "text-charcoal-muted line-through" : "text-charcoal"}>
                {item.label}
              </span>
            </li>
          ))}
          {order.checklist.length === 0 ? (
            <li className="text-sm text-charcoal-muted">No active checklist.</li>
          ) : null}
        </ul>
      </section>
      <section>
        <h3 className="text-label">Designer notes</h3>
        <p className="mt-2 flex gap-2 rounded-2xl bg-hydrangea-pale/40 p-4 text-[15px] leading-relaxed text-charcoal-muted">
          <MessageSquare className="size-[18px] shrink-0 text-sage-muted" strokeWidth={1.75} />
          {order.designerNotes || "—"}
        </p>
      </section>
    </div>
  );
}

function DeliveryTab({ order }: { order: FloristOrder }) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-label">Timeline</h3>
        <ol className="mt-4 space-y-0 border-l border-sage-soft pl-6">
          {[
            { label: "Designed", time: order.status !== "pending" ? "Complete" : "—" },
            { label: "Out for delivery", time: order.status === "out-for-delivery" ? order.eta : "—" },
            { label: "Delivered", time: order.deliveryProof.deliveredAt ?? "—" },
          ].map((step, i, arr) => (
            <li key={step.label} className={cn("relative pb-8", i === arr.length - 1 && "pb-0")}>
              <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-blush-500 ring-4 ring-warm-white" />
              <p className="font-medium text-charcoal">{step.label}</p>
              <p className="text-sm text-charcoal-muted">{step.time}</p>
            </li>
          ))}
        </ol>
      </section>
      <dl className="grid gap-4 sm:grid-cols-2">
        <DetailField label="Driver" value={order.driver} />
        <DetailField label="Route" value={order.routeSummary} />
        <DetailField label="ETA" value={order.eta} />
      </dl>
      <section>
        <h3 className="text-label">Delivery notes</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-charcoal-muted">
          {order.deliveryNotes || "—"}
        </p>
      </section>
      <section>
        <h3 className="text-label">Proof of delivery</h3>
        <div className="mt-3 rounded-2xl bg-warm-cream/60 p-5 ring-1 ring-florisyn-border/80">
          <p className="text-sm text-charcoal-muted">
            <span className="font-medium text-charcoal">Signature: </span>
            {order.deliveryProof.signedBy ?? "Pending"}
          </p>
          <p className="mt-2 text-sm text-charcoal-muted">
            <span className="font-medium text-charcoal">Photo: </span>
            {order.deliveryProof.photoNote ?? "Not captured yet"}
          </p>
        </div>
      </section>
    </div>
  );
}

function DetailField({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof CreditCard;
}) {
  return (
    <div className="rounded-2xl bg-warm-cream/40 px-4 py-3 ring-1 ring-florisyn-border/70">
      <dt className="text-label">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-[15px] font-medium capitalize text-charcoal">
        {Icon ? <Icon className="size-[16px] text-sage-muted" strokeWidth={1.75} /> : null}
        {value}
      </dd>
    </div>
  );
}
