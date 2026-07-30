import { useEffect, useMemo, useState } from "react";
import {
  PagePhotoRegistry,
  validateOrdersPhotoAssignments,
} from "../lib/floral-asset-library";
import { OrderCard } from "../components/orders/order-card";
import { OrderDetailPanel } from "../components/orders/order-detail-panel";
import { OrdersFilters } from "../components/orders/orders-filters";
import { OrdersSearchBar } from "../components/orders/orders-search-bar";
import {
  OrdersKanbanBoard,
  OrdersTimelineView,
  OrdersViewSwitcher,
  type OrdersViewMode,
} from "../components/orders/orders-views";
import type { FloristOrder, OrderFilterChip } from "../lib/orders-sample";
import { useOrdersPreview } from "../hooks/useOrdersPreview";
import { cn } from "../lib/utils";

function matchesSearch(order: FloristOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    order.customer,
    order.recipient,
    order.customerPhone,
    order.orderNumber,
    order.occasion,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matchesFilters(order: FloristOrder, active: Set<OrderFilterChip>): boolean {
  if (active.size === 0) return true;
  for (const chip of active) {
    if (chip === "pending" && order.status === "pending") return true;
    if (chip === "delivered" && order.status === "delivered") return true;
    if (order.occasionTags.includes(chip)) return true;
    if (
      chip === "funeral" &&
      /funeral|sympathy/i.test(order.occasion)
    )
      return true;
    if (chip === "wedding" && /wedding/i.test(order.occasion)) return true;
    if (chip === "birthday" && /birthday/i.test(order.occasion)) return true;
    if (chip === "anniversary" && /anniversary/i.test(order.occasion)) return true;
    if (chip === "hospital" && /hospital|get well/i.test(order.occasion)) return true;
  }
  return false;
}

export function OrdersPage() {
  const { enabled, loading, error, orders, usingFallback } = useOrdersPreview();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<OrderFilterChip>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [view, setView] = useState<OrdersViewMode>("kanban");

  useEffect(() => {
    validateOrdersPhotoAssignments("/orders");
  }, []);

  useEffect(() => {
    if (orders.length && !selectedId) setSelectedId(orders[0]?.id ?? null);
  }, [orders, selectedId]);

  const filtered = useMemo(
    () =>
      orders.filter(
        (o) => matchesSearch(o, search) && matchesFilters(o, filters),
      ),
    [orders, search, filters],
  );

  const selected =
    filtered.find((o) => o.id === selectedId) ??
    orders.find((o) => o.id === selectedId) ??
    null;

  const toggleFilter = (chip: OrderFilterChip) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  const selectOrder = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  if (!enabled && !loading) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-label">Orders preview</p>
        <h1 className="font-serif-display text-3xl font-medium text-charcoal">
          Production Orders remain active
        </h1>
        <p className="mt-3 text-charcoal-muted">
          React Orders preview is disabled (<code>REACT_ORDERS_PREVIEW=false</code>).
          Continue using the production Orders board in the main Florisyn app.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-white"
        >
          Open production Orders
        </a>
      </div>
    );
  }

  return (
    <PagePhotoRegistry pageId="orders">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col gap-8 lg:gap-10">
        <header className="animate-fade-in space-y-2">
          <p className="text-label">Orders</p>
          <h1 className="font-serif-display text-3xl font-medium text-charcoal md:text-4xl">
            Floral projects
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-charcoal-muted">
            {enabled
              ? "Read-only preview wired to the production orders API."
              : "Every order is a living arrangement — design, deliver, and delight from one calm workspace."}
          </p>
          {loading ? (
            <p className="text-sm text-sage-ink">Loading orders…</p>
          ) : null}
          {error ? (
            <p className="rounded-xl bg-warm-white px-4 py-3 text-sm text-charcoal ring-1 ring-florisyn-border">
              {error}{" "}
              <a href="/" className="underline">
                Use production Orders
              </a>
            </p>
          ) : null}
          {usingFallback && enabled && !error ? (
            <p className="text-sm text-charcoal-muted">
              Showing fallback sample data.{" "}
              <a href="/" className="underline">
                Open production Orders
              </a>
            </p>
          ) : null}
        </header>

        <OrdersSearchBar value={search} onChange={setSearch} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <OrdersViewSwitcher view={view} onChange={setView} />
          <p className="text-sm text-sage-ink">
            {filtered.length} {filtered.length === 1 ? "order" : "orders"}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-8 xl:grid xl:grid-cols-[180px_minmax(0,1fr)_min(380px,420px)] xl:items-start xl:gap-10">
          <OrdersFilters
            active={filters}
            onToggle={toggleFilter}
            className="xl:sticky xl:top-8"
          />

          <section aria-label="Order list" className="min-w-0 space-y-4">
            {view === "kanban" ? (
              <OrdersKanbanBoard
                orders={filtered}
                selectedId={selectedId}
                onSelect={selectOrder}
              />
            ) : view === "timeline" ? (
              <OrdersTimelineView orders={filtered} onSelect={selectOrder} />
            ) : (
              <>
                <ul className="space-y-4">
                  {filtered.map((order) => (
                    <li key={order.id}>
                      <OrderCard
                        order={order}
                        selected={selectedId === order.id}
                        onSelect={() => selectOrder(order.id)}
                      />
                    </li>
                  ))}
                </ul>
                {filtered.length === 0 ? (
                  <p className="rounded-2xl bg-warm-white p-10 text-center text-charcoal-muted ring-1 ring-florisyn-border">
                    No orders match your search.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <OrderDetailPanel
            order={selected}
            className={cn(
              "xl:sticky xl:top-8",
              mobileDetailOpen && selected ? "fixed inset-x-4 bottom-4 top-24 z-30 flex xl:relative xl:inset-auto" : "hidden xl:flex",
            )}
            onClose={() => setMobileDetailOpen(false)}
          />
        </div>
      </div>
    </PagePhotoRegistry>
  );
}
