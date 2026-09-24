"use client";

import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function parseDate(value: string) {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function serializeDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePickerField({
  id,
  name,
  value,
  onValueChange,
  placeholder = "Select date",
  disableFuture = false,
  className,
}: {
  id?: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disableFuture?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDate(value), [value]);
  const today = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input name={name} type="hidden" value={value} />
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarDays />
        {selected
          ? new Intl.DateTimeFormat("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }).format(selected)
          : placeholder}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? today}
          onSelect={(date) => {
            if (!date) return;
            onValueChange(serializeDate(date));
            setOpen(false);
          }}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0, 1)}
          endMonth={today}
          disabled={disableFuture ? { after: today } : undefined}
          autoFocus
        />
        {value ? (
          <div className="flex justify-end border-t p-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onValueChange("");
                setOpen(false);
              }}
            >
              Clear date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
