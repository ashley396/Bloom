import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium motion-safe-transition disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-champagne-gold focus-visible:ring-offset-2 focus-visible:ring-offset-warm-cream",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-eucalyptus to-olive text-warm-white shadow-sm ring-1 ring-forest/10 hover:from-sage-muted hover:to-eucalyptus active:scale-[0.98] motion-safe:hover:shadow-card dark:from-eucalyptus dark:to-olive",
        secondary:
          "bg-warm-white text-charcoal shadow-card ring-1 ring-florisyn-border hover:bg-linen/80 active:scale-[0.99] dark:bg-florisyn-surface",
        ghost: "text-charcoal-muted hover:bg-sage-pale/90 hover:text-charcoal",
        luxury:
          "bg-gradient-to-b from-champagne-gold/90 to-champagne-gold text-charcoal shadow-sm ring-1 ring-champagne-gold/30 hover:brightness-105 active:scale-[0.98]",
      },
      size: {
        default: "h-11 min-h-[44px] px-5 py-2",
        sm: "h-10 min-h-[40px] rounded-lg px-4",
        lg: "h-12 min-h-[48px] rounded-xl px-6 text-base",
        icon: "size-11 min-h-[44px] min-w-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
