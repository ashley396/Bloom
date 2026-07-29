import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type SurfaceCardProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingMap = {
  none: "",
  sm: "p-5",
  md: "p-6 lg:p-7",
  lg: "p-8 lg:p-9",
};

export function SurfaceCard({
  children,
  className,
  as: Tag = "div",
  padding = "md",
}: SurfaceCardProps) {
  return (
    <Tag
      className={cn(
        "rounded-2xl bg-warm-white shadow-card motion-safe-transition ring-1 ring-florisyn-border",
        paddingMap[padding],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
