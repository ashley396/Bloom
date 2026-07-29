import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type AppShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  header?: ReactNode;
};

export function AppShell({ children, sidebar, header }: AppShellProps) {
  return (
    <div className="min-h-svh bg-florisyn-cream dark:bg-florisyn-cream">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-[var(--shadow-soft)]"
      >
        Skip to main content
      </a>
      <div className="mx-auto flex min-h-svh max-w-[1400px] flex-col lg:flex-row">
        <aside
          className={cn(
            "border-b border-florisyn-sage-100 bg-florisyn-surface lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r dark:border-florisyn-sage-100",
            "px-4 py-4 lg:sticky lg:top-0 lg:h-svh lg:overflow-y-auto",
          )}
          aria-label="Primary"
        >
          {sidebar}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {header ? (
            <header className="border-b border-florisyn-sage-100 bg-florisyn-surface px-4 py-3 md:px-6 dark:border-florisyn-sage-100">
              {header}
            </header>
          ) : null}
          <main
            id="main-content"
            className="flex-1 px-4 py-6 md:px-6 lg:px-8"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
