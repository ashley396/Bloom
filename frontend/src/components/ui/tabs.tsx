import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within Tabs");
  return ctx;
}

export type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
};

export function Tabs({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  className,
  children,
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const value = valueProp ?? uncontrolled;

  const setValue = React.useCallback(
    (next: string) => {
      if (valueProp === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [onValueChange, valueProp],
  );

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div data-slot="tabs" className={cn("flex flex-col gap-4", className)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-list"
      role="tablist"
      className={cn(
        "inline-flex h-11 items-center gap-1 rounded-xl bg-sage-pale/80 p-1 ring-1 ring-florisyn-border",
        className,
      )}
      {...props}
    />
  );
}

export type TabsTriggerProps = React.ComponentProps<"button"> & {
  value: string;
};

export function TabsTrigger({ className, value, ...props }: TabsTriggerProps) {
  const { value: active, setValue } = useTabsContext();
  const selected = active === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-state={selected ? "active" : "inactive"}
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-[36px] items-center justify-center rounded-lg px-4 py-2 text-sm font-medium motion-safe-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-cream",
        selected
          ? "bg-warm-white text-charcoal shadow-sm"
          : "text-charcoal-muted hover:text-charcoal",
        className,
      )}
      onClick={() => setValue(value)}
      {...props}
    />
  );
}

export type TabsContentProps = React.ComponentProps<"div"> & {
  value: string;
};

export function TabsContent({ className, value, ...props }: TabsContentProps) {
  const { value: active } = useTabsContext();
  if (active !== value) return null;

  return (
    <div
      role="tabpanel"
      data-slot="tabs-content"
      className={cn("animate-fade-in outline-none", className)}
      {...props}
    />
  );
}
