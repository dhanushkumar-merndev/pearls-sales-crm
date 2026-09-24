"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterTab = { label: string; value: string; count?: number };

/**
 * Link-based tab bar for server-rendered pages. Each tab is a URL, so the
 * active view stays shareable and only the selected tab's data is fetched.
 */
export function FilterTabs({
  tabs,
  active,
  param = "status",
  params = {},
  ariaLabel,
  className,
}: {
  tabs: FilterTab[];
  active: string;
  param?: string;
  params?: Record<string, string | undefined>;
  ariaLabel: string;
  /** Override the default mb-4 -- e.g. mb-0 when embedded in a PageHeader's actions row. */
  className?: string;
}) {
  const [optimisticActive, setOptimisticActive] = useState(active);
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    ready: boolean;
  }>({ left: 0, top: 0, width: 0, height: 0, ready: false });

  // The pill moves the instant a tab is clicked, then the server prop catches
  // up. Adjusting during render rather than in an effect is React's documented
  // way to reset state from a prop: an effect would paint the stale tab first
  // and then re-render, which is the cascading render the linter flags.
  const [syncedActive, setSyncedActive] = useState(active);
  if (active !== syncedActive) {
    setSyncedActive(active);
    setOptimisticActive(active);
  }

  // Update pill indicator dimensions whenever active tab changes or window resizes
  useEffect(() => {
    const updateIndicator = () => {
      if (!navRef.current) return;
      const activeEl = navRef.current.querySelector<HTMLElement>(
        `[data-tab-value="${optimisticActive}"]`
      );
      if (activeEl) {
        setIndicator({
          left: activeEl.offsetLeft,
          top: activeEl.offsetTop,
          width: activeEl.offsetWidth,
          height: activeEl.offsetHeight,
          ready: true,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [optimisticActive, tabs]);

  const href = (value: string) => {
    const search = new URLSearchParams();
    for (const [key, entry] of Object.entries(params))
      if (entry && key !== param && key !== "page") search.set(key, entry);
    search.set(param, value);
    return `?${search}`;
  };

  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={cn(
        "relative mb-4 inline-flex h-8 shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-muted/80 p-0.5 border border-border/40 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {/* Animated sliding active pill indicator */}
      {indicator.ready ? (
        <span
          className="pointer-events-none absolute rounded-md bg-background shadow-xs transition-all duration-250 ease-[cubic-bezier(0.25,1,0.5,1)] dark:bg-background/90"
          style={{
            left: `${indicator.left}px`,
            top: `${indicator.top}px`,
            width: `${indicator.width}px`,
            height: `${indicator.height}px`,
          }}
        />
      ) : null}

      {tabs.map((tab) => {
        const isSelected = tab.value === optimisticActive;
        return (
          <Link
            key={tab.value}
            href={href(tab.value)}
            data-tab-value={tab.value}
            aria-current={isSelected ? "page" : undefined}
            onClick={() => setOptimisticActive(tab.value)}
            className={cn(
              "relative z-10 inline-flex h-[calc(100%-2px)] shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-0.5 text-sm font-medium whitespace-nowrap transition-all duration-200 ease-out active:scale-90 active:duration-75 select-none cursor-pointer",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isSelected
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-xs font-semibold tabular-nums transition-colors",
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "bg-foreground/10 text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
