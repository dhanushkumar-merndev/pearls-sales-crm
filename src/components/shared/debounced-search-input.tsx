"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";

export function DebouncedSearchInput({
  initialValue = "",
  placeholder,
  ariaLabel = "Search",
  paramName = "q",
  delay = SEARCH_DEBOUNCE_MS,
  className,
}: {
  initialValue?: string;
  placeholder: string;
  ariaLabel?: string;
  paramName?: string;
  delay?: number;
  className?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(() => ({
    source: initialValue,
    submitted: initialValue,
    value: initialValue,
  }));
  const [pending, startTransition] = useTransition();
  if (search.source !== initialValue) {
    const isOwnNavigation = search.submitted === initialValue;
    setSearch({
      source: initialValue,
      submitted: isOwnNavigation ? search.submitted : initialValue,
      value: isOwnNavigation ? search.value : initialValue,
    });
  }
  const value = search.value;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const nextValue = value.trim();
      if ((params.get(paramName) ?? "") === nextValue) return;

      if (nextValue) params.set(paramName, nextValue);
      else params.delete(paramName);
      params.delete("page");

      const query = params.toString();
      setSearch((current) => ({ ...current, submitted: nextValue }));
      startTransition(() => {
        router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, {
          scroll: false,
        });
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay, paramName, router, value]);

  return (
    <div className={`relative ${className ?? ""}`} role="search">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) =>
          setSearch((current) => ({ ...current, value: event.target.value }))
        }
        className="pr-9 pl-8"
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      {pending ? (
        <LoaderCircle className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}
