import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type SurfaceCardProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
  padding?: "none" | "sm" | "md" | "lg";
  hover?: boolean;
};

const paddingMap = {
  none: "",
  sm: "p-5",
  md: "p-6 md:p-7",
  lg: "p-8 md:p-10",
};

export function SurfaceCard({
  children,
  className,
  as: Tag = "div",
  padding = "md",
  hover = false,
}: SurfaceCardProps) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-florisyn-border/80 bg-florisyn-surface shadow-card motion-safe-transition",
        hover && "hover:shadow-card-hover",
        paddingMap[padding],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
