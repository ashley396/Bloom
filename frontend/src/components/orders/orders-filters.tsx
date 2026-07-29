import { cn } from "../../lib/utils";
import type { OrderFilterChip } from "../../lib/orders-sample";
import { orderFilterLabels } from "../../lib/orders-sample";

const filterOrder: OrderFilterChip[] = [
  "today",
  "tomorrow",
  "funeral",
  "wedding",
  "birthday",
  "anniversary",
  "hospital",
  "pending",
  "delivered",
];

export type OrdersFiltersProps = {
  active: Set<OrderFilterChip>;
  onToggle: (chip: OrderFilterChip) => void;
  className?: string;
};

export function OrdersFilters({ active, onToggle, className }: OrdersFiltersProps) {
  return (
    <nav className={cn("min-w-0", className)} aria-label="Order filters">
      <p className="text-label mb-4">Filters</p>
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-2">
        {filterOrder.map((chip) => {
          const isOn = active.has(chip);
          return (
            <li key={chip}>
              <button
                type="button"
                onClick={() => onToggle(chip)}
                className={cn(
                  "min-h-[44px] w-full rounded-2xl px-4 py-2.5 text-left text-sm font-medium motion-safe-transition lg:min-w-[168px]",
                  isOn
                    ? "bg-blush-50 text-charcoal ring-1 ring-blush-100 shadow-sm"
                    : "bg-warm-white text-charcoal-muted ring-1 ring-florisyn-border hover:bg-warm-ivory",
                )}
                aria-pressed={isOn}
              >
                {orderFilterLabels[chip]}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
