import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-sage-pale text-charcoal",
        secondary: "bg-warm-cream-deep text-charcoal-muted",
        primary: "bg-blush-50 text-charcoal",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        info: "bg-info-soft text-info",
        destructive: "bg-destructive-soft text-destructive",
        outline: "bg-warm-white text-charcoal ring-1 ring-florisyn-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & {
  dot?: boolean;
  dotClassName?: string;
};

export function Badge({
  className,
  variant,
  dot = false,
  dotClassName,
  children,
  ...props
}: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full bg-current opacity-70", dotClassName)}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
