"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, FileEdit, LoaderCircle, NotebookPen } from "lucide-react";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type OpVisit = {
  visit_id: string;
  patient_name: string;
  patient_phone: string;
  token_number: number;
  doctor_name: string;
  fee_paise: number;
};

/** Searches today's OP visits that still need their consultation entered. */
function VisitSearch({ onPick }: { onPick: (visit: OpVisit) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<OpVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!open) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search/op-visits-today?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        setItems(body.items ?? []);
      } catch {
        // Aborted or offline; the list just stays empty.
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-between font-normal" type="button" />
        }
      >
        <span className="truncate">{label || "Search patient"}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Token, name or phone" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> Searching
              </div>
            ) : (
              <>
                <CommandEmpty>No matching OP visit still needing entry today.</CommandEmpty>
                <CommandGroup>
                  {items.map((visit) => (
                    <CommandItem
                      key={visit.visit_id}
                      value={visit.visit_id}
                      onSelect={() => {
                        onPick(visit);
                        setLabel(`#${visit.token_number} · ${visit.patient_name}`);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          #{visit.token_number} · {visit.patient_name}
                        </p>
                        <p className="text-xs text-muted-foreground">{visit.doctor_name}</p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * For a prescription the consultant wrote on paper: pharmacy picks today's
 * visit and fills it in on the same consultation form the doctor uses, so it
 * flows into the pending queue like any other prescription.
 */
export function ManualPrescriptionDialog() {
  const [open, setOpen] = useState(false);
  const [visit, setVisit] = useState<OpVisit | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" onClick={() => setVisit(null)} />}>
        <FileEdit /> Enter Doctor&apos;s Prescription
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enter Doctor&apos;s Prescription</DialogTitle>
          <DialogDescription>
            For a prescription the consultant wrote on paper. Pick the patient, then fill it in on
            the same consultation form the doctor uses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Patient *</Label>
          <VisitSearch onPick={setVisit} />
          <p className="text-xs text-muted-foreground">
            Only shows OP visits still needing entry -- one already completed digitally has nothing
            left to do here.
          </p>
        </div>
        {visit ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              #{visit.token_number} · {visit.patient_name}
            </p>
            <p className="mt-1 text-muted-foreground">{visit.doctor_name}</p>
            <Button className="mt-3" render={<Link href={`/visits/${visit.visit_id}`} target="_blank" />}>
              <NotebookPen /> Open Consultation
            </Button>
          </div>
        ) : null}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
