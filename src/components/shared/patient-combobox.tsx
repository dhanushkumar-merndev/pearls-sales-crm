"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";

export type PatientOption = {
  id: string;
  label: string;
};

type PatientSearchResult = {
  id: string;
  name: string;
  phone_normalized: string;
};

export function PatientCombobox({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: PatientOption | null;
  onChange: (value: PatientOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PatientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const response = await fetch(
          `/api/search/patients?q=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Patient search failed");
        const body = (await response.json()) as {
          items?: PatientSearchResult[];
        };
        setItems(body.items ?? []);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setItems([]);
        setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={value?.label ?? "Search patient by phone or name"}
            disabled={disabled}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">{value?.label ?? "Search by phone or name"}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(nextQuery) => {
              setQuery(nextQuery);
              if (nextQuery.trim().length < 2) {
                setItems([]);
                setLoading(false);
                setSearchError(false);
              }
            }}
            placeholder="Type phone number or patient name"
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center p-4">
                <LoaderCircle className="animate-spin" />
              </div>
            ) : null}
            {!loading ? (
              <CommandEmpty>
                {normalizedQuery.length < 2
                  ? "Type at least 2 digits or letters."
                  : searchError
                    ? "Patient search is temporarily unavailable."
                    : "No matching patient found."}
              </CommandEmpty>
            ) : null}
            <CommandGroup>
              {items.map((item) => {
                const label = `${item.name} · ${item.phone_normalized}`;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      onChange({ id: item.id, label });
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check
                      className={value?.id === item.id ? "opacity-100" : "opacity-0"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.phone_normalized}
                      </p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
