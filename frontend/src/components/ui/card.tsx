import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  "rounded-2xl bg-warm-white text-charcoal motion-safe-transition ring-1 ring-florisyn-border",
  {
    variants: {
      variant: {
        default: "shadow-card",
        elevated: "shadow-elevated",
        interactive: "shadow-card surface-lift cursor-pointer",
        ghost: "bg-transparent shadow-none ring-0",
      },
      padding: {
        none: "",
        sm: "p-6",
        md: "p-7 lg:p-8",
        lg: "p-8 lg:p-10",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
    },
  },
);

export type CardProps = React.ComponentProps<"div"> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-7 pt-7 pb-0 lg:px-8 lg:pt-8", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn("text-heading-sm", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-body-sm text-charcoal-muted", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-7 pb-7 lg:px-8 lg:pb-8", className)}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-7 pb-7 lg:px-8 lg:pb-8", className)}
      {...props}
    />
  );
}

export { cardVariants };
