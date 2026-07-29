import { Bell, Search } from "lucide-react";
import { ThemeToggle } from "../theme/ThemeToggle";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type TodayHeaderProps = {
  className?: string;
};

/** Utility bar — greeting lives on the hero. */
export function TodayHeader({ className }: TodayHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
    >
      <label className="relative min-w-0 flex-1 sm:max-w-md">
        <span className="sr-only">Search shop</span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-sage-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          placeholder="Search orders, customers…"
          className="h-12 w-full min-w-0 rounded-2xl bg-warm-white/90 py-2 pl-11 pr-4 text-[15px] text-charcoal shadow-card ring-1 ring-florisyn-border placeholder:text-sage-muted backdrop-blur-sm focus:ring-2 focus:ring-blush-400/80"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="icon" aria-label="Notifications">
          <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </Button>
        <ThemeToggle />
        <Button type="button" variant="secondary" size="sm" className="hidden px-5 sm:inline-flex">
          Profile
        </Button>
      </div>
    </header>
  );
}
