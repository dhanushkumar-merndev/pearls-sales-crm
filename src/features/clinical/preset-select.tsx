"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CUSTOM = "__custom__";

/**
 * Preset dropdown that still lets the doctor type a free-text override.
 * Choosing "Custom…" swaps the trigger for a plain input; clearing that input
 * returns to the preset list. Presets are entry shortcuts only and carry no
 * clinical interpretation.
 */
export function PresetSelect({
  value,
  presets,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  presets: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const matchesPreset = presets.includes(value);
  const [custom, setCustom] = useState(!matchesPreset && value.length > 0);
  if (custom || (!matchesPreset && value.length > 0))
    return (
      <Input
        aria-label={ariaLabel}
        autoFocus={custom}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (!value.trim()) setCustom(false);
        }}
      />
    );
  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => {
        const selected = String(next);
        if (selected === CUSTOM) {
          setCustom(true);
          onChange("");
          return;
        }
        onChange(selected);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {presets.map((preset) => (
          <SelectItem key={preset} value={preset}>
            {preset}
          </SelectItem>
        ))}
        <SelectItem value={CUSTOM}>Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Client-supplied entry presets. Doctors may always override any of these. */
export const FREQUENCY_PRESETS = [
  "OD (1-0-0)",
  "BD (1-0-1)",
  "TDS (1-1-1)",
  "QID (1-1-1-1)",
  "HS (0-0-1)",
  "AFTERNOON (0-1-0)",
  "EVENING (0-0-1-0)",
  "WEEKLY",
  "STAT (single dose)",
  "SOS",
];

export const ROUTE_PRESETS = [
  "Oral",
  "Sublingual",
  "PR",
  "IM",
  "IV",
  "SC",
  "Topical",
  "Nasal",
  "Inhalation",
];

export const NOTES_PRESETS = [
  "After food",
  "Before food",
  "Puff",
  "Mix with water",
  "Local application",
  "At bedtime",
  "If fever",
  "If needed",
];

export const DURATION_PRESETS = [
  "1 day",
  "2 days",
  "3 days",
  "5 days",
  "7 days",
  "10 days",
  "14 days",
  "30 days",
  "SOS",
];
