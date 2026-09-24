"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { FileCheck2, History, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { saveConsultation, startConsultation } from "./actions";
import { MedicineCombobox } from "./medicine-combobox";
import { DiagnosisPicker, type DiagnosisEntry } from "./diagnosis-picker";
import { TermCombobox } from "./term-combobox";
import type { ActionState } from "@/types/hospital";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { calculatePrescriptionQuantity } from "@/lib/domain/medicine-quantity";
import { dosageFormHints } from "@/lib/domain/dosage-form";
import {
  inferInvestigationReportCategory,
  investigationReportCategories,
} from "@/lib/domain/investigation-category";
import {
  DURATION_PRESETS,
  FREQUENCY_PRESETS,
  NOTES_PRESETS,
  PresetSelect,
  ROUTE_PRESETS,
} from "./preset-select";

// Base UI's Select shows the trigger's stored value, not the item's label,
// unless a render function tells it what to show -- these are the fallback
// lookups for the few selects here whose value differs from its label text.
const FOLLOW_UP_LABELS: Record<string, string> = {
  none: "No follow-up",
  after_report: "After report",
  specific_date: "Specific date",
  after_days: "After number of days",
};
type MedicineLine = {
  key: string;
  medicine_id?: string | undefined;
  medicine_name: string;
  /** Dosage form of the picked directory medicine, if it came from there. */
  form?: string | undefined;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
  notes: string;
  quantity: number;
  quantityAuto: boolean;
};
// `form` is a UI hint only -- prescription_items stores the dose text the
// doctor confirmed, not the directory's form.
type SavedMedicineLine = Omit<MedicineLine, "key" | "quantityAuto" | "form">;
type TestLine = { key: string; test_name: string; category: string; notes: string };
type InitialConsultation = {
  symptoms?: string | null;
  history?: string | null;
  examination?: string | null;
  advice?: string | null;
  follow_up_type?: string;
  follow_up_date?: string | null;
  follow_up_days?: number | null;
};
const initialState: ActionState = { ok: false };
const newMedicine = (): MedicineLine => ({
  key: crypto.randomUUID(),
  medicine_name: "",
  dose: "",
  frequency: "BD (1-0-1)",
  duration: "3 days",
  route: "Oral",
  notes: "After food",
  quantity: 1,
  quantityAuto: true,
});

export function ConsultationEditor({
  visitId,
  initial,
  initialDiagnoses = [],
  initialMedicines = [],
  carriedForwardFrom,
  initialTests = [],
  testCategories = [],
  defaultFee,
}: {
  visitId: string;
  initial?: InitialConsultation;
  initialDiagnoses?: DiagnosisEntry[];
  initialMedicines?: SavedMedicineLine[];
  /**
   * Set when `initialMedicines` is not this visit's own prescription but the
   * previous visit's, carried forward for a follow-up so the consultant edits
   * the last prescription instead of retyping it. Already a display-ready
   * label (a formatted date, or a generic fallback), so it never reads as if
   * it were already entered for today's visit.
   */
  carriedForwardFrom?: string;
  initialTests?: Omit<TestLine, "key">[];
  /** Active report categories configured by the hospital. */
  testCategories?: string[];
  /** Configured fee, or the fee saved in this draft, always editable. */
  defaultFee?: string;
}) {
  const [state, action, pending] = useActionState(
    saveConsultation,
    initialState,
  );

  // Opening the patient is what puts them "in consultation": the doctor is with
  // them from this moment, and reception and the OP desk need to see that
  // without waiting for a draft to be saved. The RPC ignores a visit that is
  // already in progress, completed or cancelled, so this is safe to re-run.
  // Once per visit, not once per effect run: React double-invokes effects in
  // development, which fired this mutation twice on every consultation opened.
  // The RPC ignores an already-started visit, so the duplicate was harmless --
  // it was still a wasted round trip on the doctor's critical path.
  const startedVisit = useRef<string | null>(null);
  useEffect(() => {
    if (startedVisit.current === visitId) return;
    startedVisit.current = visitId;
    void startConsultation(visitId);
  }, [visitId]);
  const [medicines, setMedicines] = useState<MedicineLine[]>(
    initialMedicines.map((line) => ({
      ...line,
      key: crypto.randomUUID(),
      quantityAuto: false,
    })),
  );
  const investigationCategories = investigationReportCategories(testCategories);
  const [tests, setTests] = useState<TestLine[]>(
    initialTests.map((line) => ({
      ...line,
      category: investigationCategories.some(
        (category) => category === line.category,
      )
        ? line.category
        : inferInvestigationReportCategory(
            line.test_name,
            investigationCategories,
          ),
      key: crypto.randomUUID(),
    })),
  );
  const [followUp, setFollowUp] = useState(initial?.follow_up_type ?? "none");
  const [followUpDate, setFollowUpDate] = useState(
    initial?.follow_up_date ?? "",
  );
  // Keep the fee controlled while the consultation is open. Operational
  // realtime can refresh the surrounding server-component tree; an
  // uncontrolled defaultValue could then visibly snap back to the doctor's
  // configured fee while pharmacy is transcribing a paper prescription.
  const [fee, setFee] = useState(defaultFee ?? "");
  const updateMedicine = (key: string, patch: Partial<MedicineLine>) =>
    setMedicines((rows) =>
      rows.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // Picking a medicine sets the route its form is actually given by --
        // an injection is not "Oral", an ointment is not either -- and the
        // doctor can still change it afterwards.
        if (Object.prototype.hasOwnProperty.call(patch, "form")) {
          const route = dosageFormHints(patch.form).route;
          if (route) next.route = route;
        }
        const dosageChanged = ["dose", "frequency", "duration"].some((field) =>
          Object.prototype.hasOwnProperty.call(patch, field),
        );
        if (dosageChanged && row.quantityAuto) {
          const suggested = calculatePrescriptionQuantity(next);
          if (suggested !== null) next.quantity = suggested;
        }
        return next;
      }),
    );
  if (state.data?.completed)
    return (
      <Alert>
        <FileCheck2 />
        <AlertDescription>
          Consultation completed. The historical medical record is now
          read-only.
        </AlertDescription>
      </Alert>
    );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visitId" value={visitId} />
      <input
        type="hidden"
        name="medicines"
        value={JSON.stringify(
          medicines.map((line) => ({
            medicine_id: line.medicine_id,
            medicine_name: line.medicine_name,
            dose: line.dose,
            frequency: line.frequency,
            duration: line.duration,
            route: line.route,
            notes: line.notes,
            quantity: line.quantity,
          })),
        )}
      />
      <input
        type="hidden"
        name="tests"
        value={JSON.stringify(
          tests.map((line) => ({
            test_name: line.test_name,
            category: line.category,
            notes: line.notes,
          })),
        )}
      />
      <input type="hidden" name="followUpType" value={followUp} />
      {state.message ? (
        <Alert variant={state.ok ? "default" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="symptoms">Symptoms / Chief Complaint</Label>
            <Textarea
              id="symptoms"
              name="symptoms"
              defaultValue={initial?.symptoms ?? ""}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="history">History / Notes</Label>
            <Textarea
              id="history"
              name="history"
              defaultValue={initial?.history ?? ""}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="examination">Examination</Label>
            <Textarea
              id="examination"
              name="examination"
              defaultValue={initial?.examination ?? ""}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Assessment / Diagnosis <span className="text-destructive">*</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <DiagnosisPicker
            assessmentName="assessment"
            diagnosesName="diagnoses"
            initialValue={initialDiagnoses}
          />
          <p className="text-xs text-muted-foreground">
            Search ICD-10 or SNOMED-CT by name or code, pick a common
            diagnosis above, or switch to Other Diagnosis to add anything
            exactly as typed.
          </p>
          <p className="text-xs text-destructive">
            {state.fieldErrors?.assessment?.[0]}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Medicines</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMedicines((rows) => [...rows, newMedicine()])}
          >
            <Plus /> Add Medicine
          </Button>
        </CardHeader>
        {carriedForwardFrom ? (
          <CardContent className="pb-0">
            <Alert>
              <History />
              <AlertDescription>
                Current medication, carried forward from {carriedForwardFrom}.
                Review and correct before saving -- nothing below is entered
                for today&apos;s visit yet.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-60">Medicine</TableHead>
                  <TableHead>Dose</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {medicines.length ? (
                  medicines.map((row) => {
                    const suggestedQuantity = calculatePrescriptionQuantity(row);
                    const hints = dosageFormHints(row.form);
                    return (
                      <TableRow key={row.key}>
                      <TableCell>
                        <MedicineCombobox
                          value={row}
                          onChange={(value) => updateMedicine(row.key, value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.dose}
                          onChange={(e) =>
                            updateMedicine(row.key, { dose: e.target.value })
                          }
                          placeholder={hints.dosePlaceholder}
                          aria-label={`Dose${row.form ? ` in ${hints.quantityUnit}` : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <PresetSelect
                          ariaLabel="Frequency"
                          presets={FREQUENCY_PRESETS}
                          value={row.frequency}
                          onChange={(frequency) =>
                            updateMedicine(row.key, { frequency })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <PresetSelect
                          ariaLabel="Duration"
                          presets={DURATION_PRESETS}
                          value={row.duration}
                          onChange={(duration) =>
                            updateMedicine(row.key, { duration })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <PresetSelect
                          ariaLabel="Route"
                          presets={ROUTE_PRESETS}
                          value={row.route}
                          onChange={(route) => updateMedicine(row.key, { route })}
                        />
                      </TableCell>
                      <TableCell>
                        <PresetSelect
                          ariaLabel="Notes"
                          presets={NOTES_PRESETS}
                          value={row.notes}
                          onChange={(notes) => updateMedicine(row.key, { notes })}
                        />
                      </TableCell>
                      <TableCell className="min-w-28">
                        <Input
                          className="w-20"
                          type="number"
                          min={1}
                          value={row.quantity}
                          onChange={(e) =>
                            updateMedicine(row.key, {
                              quantity: Math.max(1, Number(e.target.value)),
                              quantityAuto: false,
                            })
                          }
                        />
                        {suggestedQuantity === null ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Enter manually
                          </p>
                        ) : row.quantityAuto && row.quantity === suggestedQuantity ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Auto: {suggestedQuantity} {hints.quantityUnit}
                          </p>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="link"
                            className="mt-1 h-auto px-0 text-[11px]"
                            onClick={() =>
                              updateMedicine(row.key, {
                                quantity: suggestedQuantity,
                                quantityAuto: true,
                              })
                            }
                          >
                            Use suggested {suggestedQuantity} {hints.quantityUnit}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Remove medicine"
                          onClick={() =>
                            setMedicines((rows) =>
                              rows.filter((item) => item.key !== row.key),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-20 text-center text-muted-foreground"
                    >
                      No medicines added. Prescribing does not change pharmacy
                      stock.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Investigations / Tests</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setTests((rows) => [
                ...rows,
                {
                  key: crypto.randomUUID(),
                  test_name: "",
                  category: inferInvestigationReportCategory(
                    "",
                    investigationCategories,
                  ),
                  notes: "",
                },
              ])
            }
          >
            <Plus /> Add Test
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {tests.map((row) => (
            <div
              className="grid gap-2 sm:grid-cols-[1.2fr_0.8fr_1fr_auto]"
              key={row.key}
            >
              {/* Picked from the investigation directory, or typed when the
                  hospital orders something the directory does not list yet. */}
              <TermCombobox
                termType="investigation"
                ariaLabel="Test name"
                placeholder="Select or type a test"
                value={row.test_name}
                onChange={(test_name) =>
                  setTests((rows) =>
                    rows.map((item) =>
                      item.key === row.key
                        ? {
                            ...item,
                            test_name,
                            category: inferInvestigationReportCategory(
                              test_name,
                              investigationCategories,
                            ),
                          }
                        : item,
                    ),
                  )
                }
              />
              {/* Which kind of investigation this is: the lab, the X-ray room
                  and the scan centre are different places, and the uploaded
                  report is filed under the same category. */}
              <Select
                value={row.category}
                onValueChange={(value) =>
                  setTests((rows) =>
                    rows.map((item) =>
                      item.key === row.key ? { ...item, category: String(value) } : item,
                    ),
                  )
                }
              >
                <SelectTrigger className="w-full" aria-label="Expected report type">
                  <SelectValue placeholder="Type">
                    {() => row.category || "Type"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {investigationCategories.map((category) => (
                    <SelectItem key={category} value={category} label={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Notes"
                value={row.notes}
                onChange={(e) =>
                  setTests((rows) =>
                    rows.map((item) =>
                      item.key === row.key
                        ? { ...item, notes: e.target.value }
                        : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove test"
                onClick={() =>
                  setTests((rows) =>
                    rows.filter((item) => item.key !== row.key),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advice & Follow-up</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="advice">Advice</Label>
            <Textarea
              id="advice"
              name="advice"
              defaultValue={initial?.advice ?? ""}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="follow-up">Follow-up</Label>
            <Select
              value={followUp}
              onValueChange={(value) => setFollowUp(value as string)}
            >
              <SelectTrigger id="follow-up" className="w-full">
                <SelectValue>{() => FOLLOW_UP_LABELS[followUp] ?? followUp}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No follow-up</SelectItem>
                <SelectItem value="after_report">After report</SelectItem>
                <SelectItem value="specific_date">Specific date</SelectItem>
                <SelectItem value="after_days">After number of days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {followUp === "specific_date" ? (
            <div className="space-y-2">
              <Label htmlFor="follow-date">Date</Label>
              <DatePickerField
                id="follow-date"
                name="followUpDate"
                value={followUpDate}
                onValueChange={setFollowUpDate}
                placeholder="Select follow-up date"
              />
            </div>
          ) : null}
          {followUp === "after_days" ? (
            <div className="space-y-2">
              <Label htmlFor="follow-days">Days</Label>
              <Input
                id="follow-days"
                name="followUpDays"
                type="number"
                min={1}
                defaultValue={initial?.follow_up_days ?? 7}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consultation Fee</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="consultation-fee">
              Fee (₹) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="consultation-fee"
              name="fee"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="500"
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              aria-describedby="consultation-fee-help"
            />
            <p
              id="consultation-fee-help"
              className="text-xs text-muted-foreground"
            >
              Required to complete. Collected at the pharmacy counter, not here.
              Enter 0 for a free follow-up.
            </p>
            {state.fieldErrors?.fee ? (
              <p className="text-xs text-destructive">
                {state.fieldErrors.fee[0]}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
        <Button
          type="submit"
          name="intent"
          value="draft"
          variant="outline"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />} Save
          Draft
        </Button>
        <Button
          type="submit"
          name="intent"
          value="complete"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <FileCheck2 />}{" "}
          Complete Consultation
        </Button>
      </div>
    </form>
  );
}
