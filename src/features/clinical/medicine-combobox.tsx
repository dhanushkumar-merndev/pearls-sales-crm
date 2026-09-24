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

export type MedicineSuggestion = {
  id: string;
  name: string;
  generic: string | null;
  strength: string | null;
  form: string;
  quantity: number;
  availability: string;
};
export type MedicineChoice = {
  medicine_id?: string | undefined;
  medicine_name: string;
  /** Directory dosage form, so the row can prompt in the right unit. */
  form?: string | undefined;
};
export function MedicineCombobox({
  value,
  onChange,
  searchEndpoint = "/api/search/medicines",
  emptyMessage = "No medicine found. Typed text can still be prescribed.",
}: {
  value: { medicine_id?: string | undefined; medicine_name: string };
  onChange: (value: MedicineChoice) => void;
  searchEndpoint?: string;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value.medicine_name);
  const [items, setItems] = useState<MedicineSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const response = await fetch(
          `${searchEndpoint}?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Medicine search failed");
        const body = await response.json();
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
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, searchEndpoint]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-label={value.medicine_name || "Search medicine"}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          {value.medicine_name || "Search medicine"}
        </span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(text) => {
              setQuery(text);
              // Free text is no longer the directory medicine that was
              // picked, so its id and dosage form go with it -- otherwise the
              // dose box keeps prompting in the old medicine's unit.
              onChange({ medicine_name: text, medicine_id: undefined, form: undefined });
            }}
            placeholder="Type at least 2 letters"
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center p-4">
                <LoaderCircle className="animate-spin" />
              </div>
            ) : null}
            <CommandEmpty>
              {searchError
                ? "Stock search is temporarily unavailable. Typed text can still be entered."
                : emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange({
                      medicine_id: item.id,
                      medicine_name: item.name,
                      form: item.form,
                    });
                    setQuery(item.name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={
                      value.medicine_id === item.id
                        ? "opacity-100"
                        : "opacity-0"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.generic ?? ""} {item.strength ?? ""} ·{" "}
                      {item.availability.replaceAll("_", " ")}: {item.quantity}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
