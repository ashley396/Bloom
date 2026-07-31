import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type SurfaceCardProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
  padding?: "none" | "sm" | "md" | "lg";
  /** Subtle lift on hover — cards only, not nested lists. */
  interactive?: boolean;
};

const paddingMap = {
  none: "",
  sm: "p-6",
  md: "p-7 lg:p-8",
  lg: "p-8 lg:p-10",
};

export function SurfaceCard({
  children,
  className,
  as: Tag = "div",
  padding = "md",
  interactive = false,
}: SurfaceCardProps) {
  return (
    <Tag
      className={cn(
        "rounded-2xl bg-warm-white shadow-card motion-safe-transition ring-1 ring-florisyn-border",
        interactive && "surface-lift",
        paddingMap[padding],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
