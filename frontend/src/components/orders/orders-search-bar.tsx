import { Search } from "lucide-react";
import { cn } from "../../lib/utils";

export type OrdersSearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function OrdersSearchBar({ value, onChange, className }: OrdersSearchBarProps) {
  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">Search orders</span>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-sage-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Customer, recipient, phone, order #, occasion…"
        className="h-12 w-full rounded-2xl bg-warm-white py-2 pl-11 pr-4 text-[15px] text-charcoal shadow-card ring-1 ring-florisyn-border placeholder:text-sage-muted focus:ring-2 focus:ring-blush-400/80"
      />
    </label>
  );
}
