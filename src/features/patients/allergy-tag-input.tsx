"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";

/**
 * Starter chips for a hospital with no history yet. Once patients are on file,
 * what the hospital actually records outranks this list.
 */
const COMMON_ALLERGIES = [
  "Penicillin",
  "Sulfa drugs",
  "Aspirin",
  "Ibuprofen",
  "Cephalosporins",
  "Iodine / contrast dye",
  "Latex",
  "Peanuts",
  "Seafood",
  "Dust",
];

const splitStored = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * Allergy entry as removable tags.
 *
 * Allergies used to be one free-text box, so the same allergy was typed a dozen
 * ways and a doctor scanning the history could miss one. Staff now tap what the
 * hospital already records, and can still type anything that is not on the list
 * -- an unusual allergy must never be blocked.
 *
 * The tags are serialised into a hidden input, so the surrounding server action
 * keeps taking a single `allergies` string exactly as before.
 */
export function AllergyTagInput({
  name = "allergies",
  initialValue = "",
  id,
}: {
  name?: string;
  initialValue?: string;
  id?: string;
}) {
  const [tags, setTags] = useState<string[]>(() => splitStored(initialValue));
  const [draft, setDraft] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!focused) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/allergies?q=${encodeURIComponent(draft.trim())}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        setKnown((body.items ?? []).map((item: { allergy: string }) => item.allergy));
      } catch {
        // Offline or aborted: the common list below still works, and anything
        // can be typed by hand.
        setKnown([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, focused]);

  const add = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return;
    // Case-insensitive: "penicillin" must not be added next to "Penicillin".
    // Read `rows` from React's updater rather than the render closure: a staff
    // member can tap a suggestion and immediately press Enter for another
    // allergy before the first state update has rendered.
    setTags((rows) => (
      rows.some((tag) => tag.toLowerCase() === text.toLowerCase())
        ? rows
        : [...rows, text]
    ));
    setDraft("");
  };

  const suggestions = [...known, ...COMMON_ALLERGIES]
    .filter((item, index, all) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)
    .filter((item) => !tags.some((tag) => tag.toLowerCase() === item.toLowerCase()))
    .filter((item) => item.toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={tags.join(", ")} />

      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 py-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                className="rounded-sm hover:text-destructive"
                onClick={() => setTags((rows) => rows.filter((row) => row !== tag))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter must add the allergy, not submit the patient form.
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
            if (event.key === "Backspace" && !draft && tags.length) {
              setTags((rows) => rows.slice(0, -1));
            }
          }}
          placeholder="Type an allergy and press Enter"
          aria-label="Add an allergy"
        />
        <Button type="button" variant="outline" onClick={() => add(draft)} disabled={!draft.trim()}>
          <Plus /> Add
        </Button>
      </div>

      {suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => add(item)}
              className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              + {item}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Tap a suggestion or type your own. Leave empty if there are no known allergies.
      </p>
    </div>
  );
}
