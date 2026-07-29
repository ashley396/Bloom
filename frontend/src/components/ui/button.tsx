import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium motion-safe-transition disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-florisyn-sage-500 focus-visible:ring-offset-2 focus-visible:ring-offset-florisyn-cream",
  {
    variants: {
      variant: {
        default:
          "bg-florisyn-sage-700 text-white hover:bg-florisyn-sage-900 active:scale-[0.98] dark:bg-florisyn-sage-500 dark:text-florisyn-ink dark:hover:bg-florisyn-sage-500/90",
        secondary:
          "border border-florisyn-sage-100 bg-white text-florisyn-ink hover:bg-florisyn-sage-50 dark:border-florisyn-sage-100 dark:bg-florisyn-surface dark:hover:bg-florisyn-sage-50/10",
        ghost:
          "text-florisyn-sage-700 hover:bg-florisyn-sage-50 dark:text-florisyn-sage-500 dark:hover:bg-florisyn-sage-50/10",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-6",
        icon: "size-10",
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
