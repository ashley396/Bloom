import { useEffect, useMemo, useState } from "react";
import {
  PagePhotoRegistry,
  validateOrdersPhotoAssignments,
} from "../lib/floral-asset-library";
import { OrderCard } from "../components/orders/order-card";
import { OrderDetailPanel } from "../components/orders/order-detail-panel";
import { OrdersFilters } from "../components/orders/orders-filters";
import { OrdersSearchBar } from "../components/orders/orders-search-bar";
import type { FloristOrder, OrderFilterChip } from "../lib/orders-sample";
import { ordersSample } from "../lib/orders-sample";
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
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<OrderFilterChip>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(ordersSample[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    validateOrdersPhotoAssignments("/orders");
  }, []);

  const filtered = useMemo(
    () =>
      ordersSample.filter(
        (o) => matchesSearch(o, search) && matchesFilters(o, filters),
      ),
    [search, filters],
  );

  const selected =
    filtered.find((o) => o.id === selectedId) ??
    ordersSample.find((o) => o.id === selectedId) ??
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

  return (
    <PagePhotoRegistry pageId="orders">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col gap-8 lg:gap-10">
        <header className="animate-fade-in space-y-2">
          <p className="text-label">Orders</p>
          <h1 className="font-serif-display text-3xl font-medium text-charcoal md:text-4xl">
            Floral projects
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-charcoal-muted">
            Every order is a living arrangement — design, deliver, and delight from one calm
            workspace.
          </p>
        </header>

        <OrdersSearchBar value={search} onChange={setSearch} />

        <div className="flex min-h-0 flex-1 flex-col gap-8 xl:grid xl:grid-cols-[180px_minmax(0,1fr)_min(380px,420px)] xl:items-start xl:gap-10">
          <OrdersFilters
            active={filters}
            onToggle={toggleFilter}
            className="xl:sticky xl:top-8"
          />

          <section aria-label="Order list" className="min-w-0 space-y-4">
            <p className="text-sm text-sage-ink">
              {filtered.length} {filtered.length === 1 ? "order" : "orders"}
            </p>
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
