import * as React from "react";
import { cn } from "@/lib/utils";

const inputBase =
  "flex w-full min-h-[44px] rounded-xl border border-florisyn-border bg-warm-white px-4 py-2.5 text-sm text-charcoal shadow-sm motion-safe-transition placeholder:text-charcoal-subtle focus-visible:border-blush-400 focus-visible:ring-2 focus-visible:ring-blush-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-cream disabled:cursor-not-allowed disabled:opacity-50 dark:bg-florisyn-surface dark:focus-visible:ring-offset-warm-cream";

export type InputProps = React.ComponentProps<"input">;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(inputBase, className)}
      {...props}
    />
  );
});

export type TextareaProps = React.ComponentProps<"textarea">;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        inputBase,
        "min-h-[120px] resize-y leading-relaxed",
        className,
      )}
      {...props}
    />
  );
});

export type SelectProps = React.ComponentProps<"select">;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      data-slot="select"
      className={cn(inputBase, "cursor-pointer appearance-none pr-10", className)}
      {...props}
    >
      {children}
    </select>
  );
});

export type CheckboxProps = Omit<React.ComponentProps<"input">, "type">;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-[18px] shrink-0 cursor-pointer rounded-md border border-florisyn-border-strong bg-warm-white text-blush-500 accent-blush-500 motion-safe-transition focus-visible:ring-2 focus-visible:ring-blush-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-cream disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
