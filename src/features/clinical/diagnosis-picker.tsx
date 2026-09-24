"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";

export type ClinicalTerm = {
  id?: string;
  display_text: string;
  code: string | null;
  code_system: string | null;
  source?: string | null;
  mapped?: boolean;
};

export type DiagnosisEntry = {
  term_id?: string;
  display_text: string;
  code?: string;
  code_system?: string;
  status: "provisional" | "confirmed";
  notes?: string;
};

type CodeSystemTab = "ICD-10" | "SNOMED-CT" | "other";

const TABS: Array<{ value: CodeSystemTab; label: string }> = [
  { value: "ICD-10", label: "ICD 10" },
  { value: "SNOMED-CT", label: "SNOMED-CT" },
  { value: "other", label: "Other Diagnosis" },
];

// Tailwind needs the full class names present somewhere for the JIT scanner
// to keep them -- kept as a literal map rather than built from code_system.
const SYSTEM_DOT: Record<string, string> = {
  "ICD-10": "bg-blue-500",
  "SNOMED-CT": "bg-emerald-500",
};

// A hospital-configurable shortlist would belong in Masters; hardcoded here
// for now as the one-click chips the reference layout shows above the tabs.
const COMMON_DIAGNOSES = [
  "Diabetes mellitus",
  "HTN - Hypertension",
  "Acute gastritis",
  "Upper respiratory infection",
  "Lower respiratory infection",
  "Eczema",
  "Lumbar sprain",
  "Osteoarthritis",
  "Cervical spondylosis",
  "Tinea",
  "Diabetic foot",
  "Ulcer",
  "Abscess",
  "Pharyngitis",
  "Tonsillitis",
  "Injury",
  "Dog bite - wound",
  "Cat bite - wound",
];
const COMMON_SHOWN = 3;

/**
 * Assessment/Diagnosis entry. Redesigned around the three coding contexts a
 * diagnosis can come from: ICD-10 is searched in the editable clinical
 * directory, while SNOMED-CT searches the locally imported official RF2
 * terminology and retains the hospital's uncoded shortlist as a fallback.
 * Results are filtered by PostgreSQL before its result limit is applied;
 * fallback phrases are clearly marked as mapping pending. "Other Diagnosis" is
 * always free text, no directory lookup. A shortlist of common diagnoses
 * above the tabs adds a name in one click without a code system at all.
 * Every added diagnosis carries a Provisional/Confirmed status and an
 * optional note captured at add time.
 *
 * Renders two hidden inputs: `assessmentName` is still the plain joined-text
 * field (`Display text (CODE)` per line) every existing reader --
 * print/prescription, exports, dashboards -- already expects unchanged;
 * `diagnosesName` carries the full structured list the database also now
 * stores per-entry (see the 20260819120000 migration).
 */
export function DiagnosisPicker({
  assessmentName,
  diagnosesName,
  initialValue = [],
}: {
  assessmentName: string;
  diagnosesName: string;
  initialValue?: DiagnosisEntry[];
}) {
  const [entries, setEntries] = useState<DiagnosisEntry[]>(initialValue);
  const [system, setSystem] = useState<CodeSystemTab>("ICD-10");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"provisional" | "confirmed">("provisional");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ClinicalTerm[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (system === "other" || !open || query.trim().length < 2) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search/clinical-terms?type=diagnosis&codeSystem=${encodeURIComponent(system)}&q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        setItems((body.items ?? []) as ClinicalTerm[]);
      } catch {
        // Aborted or offline: the free-text "add as typed" path still works.
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, system]);

  const add = (entry: DiagnosisEntry) => {
    const text = entry.display_text.trim();
    if (!text || entries.some((e) => e.display_text.toLowerCase() === text.toLowerCase())) return;
    setEntries((rows) => [...rows, { ...entry, display_text: text }]);
    setQuery("");
    setNotes("");
    setOpen(false);
  };
  const addFromDirectory = (item: ClinicalTerm) =>
    add({
      // Official SNOMED terms have no local clinical_terms UUID. Omit the
      // optional foreign key instead of serializing null, while retaining the
      // official concept code and display text on the diagnosis entry.
      term_id: item.id ?? undefined,
      display_text: item.display_text,
      code: item.code ?? undefined,
      code_system: item.code_system ?? undefined,
      status,
      notes: notes.trim() || undefined,
    });
  const addTyped = () =>
    add({
      display_text: query,
      // Typed text is a hospital-local diagnosis, not an ICD/SNOMED code.
      // It becomes searchable after save, but is never falsely labelled as
      // coded terminology merely because that tab happened to be open.
      status,
      notes: notes.trim() || undefined,
    });
  const remove = (text: string) =>
    setEntries((rows) => rows.filter((row) => row.display_text !== text));
  const toggleCommon = (name: string) => {
    if (entries.some((e) => e.display_text === name)) remove(name);
    else add({ display_text: name, status: "provisional" });
  };

  const assessmentText = entries
    .map((e) => (e.code ? `${e.display_text} (${e.code})` : e.display_text))
    .join("\n");
  const shownCommon = COMMON_DIAGNOSES.slice(0, COMMON_SHOWN);
  const restCommon = COMMON_DIAGNOSES.slice(COMMON_SHOWN);
  const usedSystems = [...new Set(entries.map((e) => e.code_system).filter(Boolean))] as string[];

  return (
    <div className="space-y-3">
      <input type="hidden" name={assessmentName} value={assessmentText} />
      <input type="hidden" name={diagnosesName} value={JSON.stringify(entries)} />

      <div className="flex flex-wrap items-center gap-2">
        {shownCommon.map((name) => (
          <label
            key={name}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
          >
            <Checkbox
              checked={entries.some((e) => e.display_text === name)}
              onCheckedChange={() => toggleCommon(name)}
            />
            {name}
          </label>
        ))}
        {restCommon.length ? (
          <Popover>
            <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
              +{restCommon.length} more
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {restCommon.map((name) => (
                  <label
                    key={name}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={entries.some((e) => e.display_text === name)}
                      onCheckedChange={() => toggleCommon(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      <Tabs
        value={system}
        onValueChange={(value) => {
          setSystem(value as CodeSystemTab);
          setQuery("");
          setOpen(false);
        }}
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
        {system === "other" ? (
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Enter Diagnosis"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTyped();
              }
            }}
          />
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-normal"
                />
              }
            >
              <span className={query ? "truncate" : "truncate text-muted-foreground"}>
                {query || `Search ${system}`}
              </span>
            </PopoverTrigger>
            <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput value={query} onValueChange={setQuery} placeholder={`Search ${system}`} />
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
                          : `No ${system} match. Use + to add it as a local diagnosis.`}
                      </CommandEmpty>
                      <CommandGroup>
                        {(query.trim().length < 2 ? [] : items).map((item) => (
                          <CommandItem
                            key={item.display_text}
                            value={item.display_text}
                            onSelect={() => addFromDirectory(item)}
                          >
                            <span className="flex-1">{item.display_text}</span>
                            {item.code ? (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {item.code}
                              </span>
                            ) : system === "SNOMED-CT" ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Local term · mapping pending
                              </span>
                            ) : null}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="provisional">Provisional</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Add diagnosis"
          disabled={!query.trim()}
          onClick={addTyped}
        >
          <Plus />
        </Button>
      </div>
      <Input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Diagnosis Notes"
      />

      {entries.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <Badge key={entry.display_text} variant="secondary" className="gap-1.5 py-1">
                {entry.code_system && SYSTEM_DOT[entry.code_system] ? (
                  <span className={`size-1.5 shrink-0 rounded-full ${SYSTEM_DOT[entry.code_system]}`} />
                ) : null}
                {entry.display_text}
                {entry.code ? <span className="text-muted-foreground">({entry.code})</span> : null}
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  {entry.status}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${entry.display_text}`}
                  className="rounded-sm hover:text-destructive"
                  onClick={() => remove(entry.display_text)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          {usedSystems.length ? (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {usedSystems.map((sys) => (
                <span key={sys} className="flex items-center gap-1">
                  <span className={`size-1.5 rounded-full ${SYSTEM_DOT[sys] ?? "bg-muted-foreground"}`} />
                  {sys}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
