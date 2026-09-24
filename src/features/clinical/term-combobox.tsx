"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";

type Term = { display_text: string; code: string | null };

/**
 * Single-value clinical term picker: the doctor chooses from the directory or
 * types their own wording, in the same box.
 *
 * Used for investigation names, where a hospital orders the same twenty tests
 * every day but must never be blocked from writing an unusual one.
 */
export function TermCombobox({
  termType,
  value,
  onChange,
  placeholder = "Select or type",
  ariaLabel,
}: {
  termType: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Term[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search/clinical-terms?type=${termType}&q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        setItems(body.items ?? []);
      } catch {
        // Aborted or offline: typing the name still works.
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, termType]);

  const choose = (next: string) => {
    onChange(next.trim());
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className={value ? "truncate" : "truncate text-muted-foreground"}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> Searching
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {query.trim().length < 2
                    ? "Type at least 2 characters."
                    : "Not in the directory. Press Add to use it as typed."}
                </CommandEmpty>
                <CommandGroup>
                  {(query.trim().length < 2 ? [] : items).map((item) => (
                    <CommandItem
                      key={item.display_text}
                      value={item.display_text}
                      onSelect={() => choose(item.display_text)}
                    >
                      <span className="flex-1">{item.display_text}</span>
                      {item.code ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {item.code}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                  {query.trim().length >= 2 ? (
                    <CommandItem value={`__free__${query}`} onSelect={() => choose(query)}>
                      <Plus className="size-4" />
                      Add &ldquo;{query.trim()}&rdquo; as typed
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
