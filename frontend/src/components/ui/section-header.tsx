import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  eyebrow?: string;
};

export function SectionHeader({
  title,
  description,
  action,
  eyebrow,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="max-w-xl">
        {eyebrow ? <p className="text-label mb-2">{eyebrow}</p> : null}
        <h2 className="text-heading-md">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-body-sm text-charcoal-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
