"use client";

import { createContext, use, useEffect, useState } from "react";

type PageTitle = { title: string; description: string };

/**
 * Lets the page's own heading appear in the app bar on a phone.
 *
 * Screen height is the scarce resource on mobile: the title and its one-line
 * description used to sit below a mostly empty app bar, pushing the actual
 * work — search box, table — further down. The bar already has room beside the
 * sidebar trigger, so the heading moves up into it there and stays in place on
 * larger screens, where vertical space is not the constraint.
 *
 * A context rather than props because the app bar lives in the layout and the
 * heading is declared by each page; the app router gives a layout no access to
 * its child page's props.
 */
const PageTitleContext = createContext<{
  value: PageTitle | null;
  set: (value: PageTitle | null) => void;
} | null>(null);

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [value, set] = useState<PageTitle | null>(null);
  return (
    <PageTitleContext value={{ value, set }}>{children}</PageTitleContext>
  );
}

/** Rendered by PageHeader; publishes the heading and clears it on navigation. */
export function RegisterPageTitle({ title, description }: PageTitle) {
  const context = use(PageTitleContext);
  const set = context?.set;
  useEffect(() => {
    if (!set) return;
    set({ title, description });
    return () => set(null);
  }, [set, title, description]);
  return null;
}

/** The heading as shown inside the app bar. Phones only. */
export function HeaderPageTitle() {
  const context = use(PageTitleContext);
  const value = context?.value;
  if (!value) return null;
  // A real <h1>, not a styled paragraph: this is the page's heading on a phone,
  // and the in-page copy is display:none there, so exactly one heading is ever
  // exposed to a screen reader.
  return (
    <div className="min-w-0 flex-1 sm:hidden">
      <h1 className="truncate text-sm leading-tight font-semibold">{value.title}</h1>
      <p className="truncate text-xs leading-tight text-muted-foreground">
        {value.description}
      </p>
    </div>
  );
}
