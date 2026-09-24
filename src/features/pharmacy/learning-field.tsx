"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A field that can be typed into freely *and* picked from, where the list of
 * choices is whatever the pharmacy has entered before (medicine_field_options,
 * filled by a trigger on save). Typing a dosage form nobody has used yet is
 * therefore not a dead end: it is saved with the medicine, and the next dialog
 * offers it in the list.
 *
 * The visible box is the real form input -- there is no hidden mirror field to
 * fall out of sync -- so an option that was never picked from the list submits
 * exactly as typed.
 */
export function LearningField({
  name,
  label,
  options,
  defaultValue = "",
  required = false,
  placeholder,
}: {
  name: string;
  label: string;
  options: string[];
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needle = value.trim().toLowerCase();
  // An exact match is dropped: re-offering what is already typed is noise.
  const matches = options
    .filter((option) => {
      const candidate = option.toLowerCase();
      return candidate !== needle && (!needle || candidate.includes(needle));
    })
    .slice(0, 8);
  const showList = open && matches.length > 0;

  const choose = (option: string) => {
    setValue(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={value}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          className="pr-8"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // A click on an option fires mousedown first (which selects and
            // closes); this only handles focus genuinely leaving the field.
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (!matches.length) return;
              event.preventDefault();
              setOpen(true);
              setActive((current) => {
                const step = event.key === "ArrowDown" ? 1 : -1;
                const next = current + step;
                if (next < 0) return matches.length - 1;
                return next >= matches.length ? 0 : next;
              });
              return;
            }
            if (event.key === "Enter" && showList && active >= 0) {
              // Only steals Enter while an option is highlighted, so the
              // dialog can still be submitted from the keyboard otherwise.
              event.preventDefault();
              choose(matches[active]);
              return;
            }
            if (event.key === "Escape" && showList) {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 opacity-50"
        />
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {matches.map((option, index) => (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  className={cn(
                    "w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm",
                    index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    // Before blur, so the click is not cancelled by the list
                    // unmounting underneath the pointer.
                    event.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    choose(option);
                  }}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
