"use client";

import * as React from "react";
import { LoaderCircle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";
import type { LocationDetails, LocationSuggestion } from "@/types/location";

const MIN_QUERY_LENGTH = 3;
const MAX_SUGGESTIONS = 3;
const suggestionCache = new Map<string, LocationSuggestion[]>();

type LocationAutocompleteProps = Omit<
  React.ComponentProps<typeof Textarea>,
  "defaultValue" | "onChange" | "value"
> & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onLocationSelect?: (location: LocationDetails) => void;
  containerClassName?: string;
};

type SearchStatus = "idle" | "loading" | "success" | "error";

function manualLocation(address: string): LocationDetails {
  return {
    address,
    latitude: null,
    longitude: null,
    city: null,
    state: null,
    country: null,
    postcode: null,
    placeId: null,
    locationSource: "manual",
  };
}

function cacheSuggestions(query: string, items: LocationSuggestion[]) {
  if (suggestionCache.size >= 50) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest) suggestionCache.delete(oldest);
  }
  suggestionCache.set(query, items);
}

export function LocationAutocomplete({
  value,
  defaultValue = "",
  onChange,
  onLocationSelect,
  containerClassName,
  className,
  disabled,
  id,
  onBlur,
  onFocus,
  onKeyDown,
  placeholder = "Search or enter location",
  rows = 2,
  ...props
}: LocationAutocompleteProps) {
  const generatedId = React.useId();
  const fieldId = id ?? `location-${generatedId}`;
  const listboxId = `${fieldId}-suggestions`;
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [searchText, setSearchText] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<LocationSuggestion[]>([]);
  const [status, setStatus] = React.useState<SearchStatus>("idle");
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const focusedRef = React.useRef(false);
  const currentValue = value ?? internalValue;

  React.useEffect(() => {
    const query = searchText.trim();
    if (query.length < MIN_QUERY_LENGTH) return;

    const normalizedQuery = query.toLocaleLowerCase("en-IN");
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const cached = suggestionCache.get(normalizedQuery);
      if (cached) {
        if (controller.signal.aborted) return;
        setSuggestions(cached);
        setHighlightedIndex(-1);
        setStatus("success");
        setOpen(focusedRef.current);
        return;
      }

      setStatus("loading");
      setOpen(focusedRef.current);
      try {
        const response = await fetch(
          `/api/search/locations?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Location search unavailable");
        const body = (await response.json()) as {
          items?: LocationSuggestion[];
        };
        if (controller.signal.aborted) return;
        const items = (body.items ?? []).slice(0, MAX_SUGGESTIONS);
        cacheSuggestions(normalizedQuery, items);
        setSuggestions(items);
        setHighlightedIndex(-1);
        setStatus("success");
        setOpen(focusedRef.current);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setSuggestions([]);
        setHighlightedIndex(-1);
        setStatus("error");
        setOpen(focusedRef.current);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchText]);

  function updateValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
  }

  function handleManualChange(nextValue: string) {
    updateValue(nextValue);
    onLocationSelect?.(manualLocation(nextValue));
    setSearchText(nextValue);
    setHighlightedIndex(-1);

    if (nextValue.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setStatus("idle");
      setOpen(false);
    } else {
      setOpen(true);
    }
  }

  function selectLocation(location: LocationSuggestion) {
    updateValue(location.address);
    onLocationSelect?.(location);
    setSearchText("");
    setSuggestions([]);
    setHighlightedIndex(-1);
    setStatus("idle");
    setOpen(false);
  }

  const showDropdown =
    open &&
    !disabled &&
    currentValue.trim().length >= MIN_QUERY_LENGTH &&
    (status !== "idle" || suggestions.length > 0);

  return (
    <div
      className={cn("relative", containerClassName)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedRef.current = false;
          setOpen(false);
        }
      }}
    >
      <div className="relative">
        <Textarea
          {...props}
          id={fieldId}
          value={currentValue}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showDropdown}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0
              ? `${listboxId}-option-${highlightedIndex}`
              : undefined
          }
          aria-busy={status === "loading"}
          className={cn("pr-9", className)}
          onChange={(event) => handleManualChange(event.target.value)}
          onFocus={(event) => {
            focusedRef.current = true;
            if (suggestions.length || status !== "idle") {
              setOpen(true);
            }
            onFocus?.(event);
          }}
          onBlur={onBlur}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setHighlightedIndex((index) =>
                index < suggestions.length - 1 ? index + 1 : 0,
              );
            } else if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setHighlightedIndex((index) =>
                index > 0 ? index - 1 : suggestions.length - 1,
              );
            } else if (event.key === "Enter" && showDropdown) {
              event.preventDefault();
              if (highlightedIndex >= 0) {
                selectLocation(suggestions[highlightedIndex]);
              } else {
                // Enter accepts the exact typed address. A suggestion is only
                // chosen after explicit arrow-key navigation or a click/tap.
                onLocationSelect?.(manualLocation(currentValue));
                setSearchText("");
                setOpen(false);
              }
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
              setSearchText("");
            }
            onKeyDown?.(event);
          }}
        />
        {status === "loading" ? (
          <LoaderCircle
            aria-hidden="true"
            className="absolute top-2.5 right-2.5 size-4 animate-spin text-muted-foreground"
          />
        ) : (
          <MapPin
            aria-hidden="true"
            className="absolute top-2.5 right-2.5 size-4 text-muted-foreground"
          />
        )}
      </div>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Location suggestions"
          className="absolute top-full right-0 left-0 z-70 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {status === "loading" && !suggestions.length ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Searching locations…
            </p>
          ) : suggestions.length ? (
            suggestions.map((location, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                key={location.placeId ?? `${location.address}-${index}`}
                type="button"
                role="option"
                aria-selected={highlightedIndex === index}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none",
                  highlightedIndex === index
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectLocation(location)}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {location.primaryText}
                  </span>
                  {location.secondaryText ? (
                    <span className="block text-xs leading-4 text-muted-foreground">
                      {location.secondaryText}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {status === "error"
                ? "Suggestions are unavailable — continue entering the address manually."
                : "No suggestions found — continue with the entered location."}
            </p>
          )}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {status === "loading"
          ? "Searching locations"
          : status === "success"
            ? `${suggestions.length} location suggestions available`
            : ""}
      </span>
    </div>
  );
}
