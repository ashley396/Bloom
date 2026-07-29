import { Bell, Search, UserCircle } from "lucide-react";
import { ThemeToggle } from "../theme/ThemeToggle";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type TodayHeaderProps = {
  firstName: string;
  dateLabel: string;
  className?: string;
};

export function TodayHeader({ firstName, dateLabel, className }: TodayHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-6 border-b border-florisyn-border pb-8 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal-subtle">Today</p>
        <h1 className="font-serif-display mt-1 text-3xl font-semibold text-charcoal md:text-4xl lg:text-[2.75rem] lg:leading-tight">
          Good morning, {firstName}
        </h1>
        <p className="mt-2 text-sm text-charcoal-muted md:text-base">
          <time dateTime={dateLabel}>{dateLabel}</time>
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
        <label className="relative min-w-0 flex-1 sm:min-w-[220px] sm:max-w-xs lg:max-w-sm">
          <span className="sr-only">Search shop</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-charcoal-subtle"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search orders, customers…"
            className="h-11 w-full min-w-0 rounded-xl bg-warm-white py-2 pl-10 pr-4 text-sm text-charcoal shadow-sm ring-1 ring-florisyn-border placeholder:text-charcoal-subtle focus:ring-2 focus:ring-blush-400"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="icon" aria-label="Notifications">
            <Bell className="size-5" aria-hidden />
          </Button>
          <ThemeToggle />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2 pl-2 pr-3"
            aria-label="Account menu"
          >
            <UserCircle className="size-5 text-charcoal-muted" aria-hidden />
            <span className="hidden sm:inline">Profile</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
