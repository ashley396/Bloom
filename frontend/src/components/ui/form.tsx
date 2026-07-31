import * as React from "react";
import { cn } from "@/lib/utils";

export function FormField({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-field"
      className={cn("grid gap-2", className)}
      {...props}
    />
  );
}

export function FormDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="form-description"
      className={cn("text-caption", className)}
      {...props}
    />
  );
}

export function FormMessage({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p
      data-slot="form-message"
      role="alert"
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function FormRow({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-row"
      className={cn("grid gap-4 sm:grid-cols-2", className)}
      {...props}
    />
  );
}

export function FormActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-actions"
      className={cn("flex flex-wrap items-center gap-3 pt-2", className)}
      {...props}
    />
  );
}
