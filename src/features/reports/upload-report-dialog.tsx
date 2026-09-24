"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { uploadReport } from "./actions";
import { compressPatientDocument } from "./compress-document";
import type { ActionState } from "@/types/hospital";
import { DatePickerField } from "@/components/shared/date-picker-field";
import {
  PatientCombobox,
  type PatientOption,
} from "@/components/shared/patient-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
const initial: ActionState = { ok: false };
const today = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
export function UploadReportDialog({
  categories,
  testOrders = [],
  initialPatient = null,
  initialVisitId = "",
  lockPatient = false,
  initialTestOrderId = "",
}: {
  categories: Array<{ id: string; name: string }>;
  testOrders?: Array<{ id: string; patientId: string; patientLabel: string; visitId: string | null; label: string }>;
  initialPatient?: PatientOption | null;
  initialVisitId?: string;
  lockPatient?: boolean;
  initialTestOrderId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const file = formData.get("file");
      if (file instanceof File && file.size > 0) {
        try {
          formData.set("file", await compressPatientDocument(file));
        } catch (error) {
          return { ok: false, fieldErrors: { file: [(error as Error).message] } };
        }
      }
      return uploadReport(previous, formData);
    },
    initial,
  );
  const [patient, setPatient] = useState<PatientOption | null>(initialPatient);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [testOrder, setTestOrder] = useState(initialTestOrderId);
  const [reportDate, setReportDate] = useState(today);
  const linkedTest = testOrders.find((item) => item.id === testOrder);
  const categoryName =
    categories.find((item) => item.id === category)?.name ??
    "Select category";
  const testOrderLabel =
    testOrders.find((item) => item.id === testOrder)?.label ??
    "Not linked to an order";
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    toast.success("Report uploaded privately");
    router.refresh();
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [router, state.ok]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <FileUp /> Upload Report
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Upload patient report</DialogTitle>
            <DialogDescription>
              Files are stored in a private bucket and opened using short-lived
              authenticated links.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="patientId" value={patient?.id ?? ""} />
          <input type="hidden" name="categoryId" value={category} />
          <input type="hidden" name="testOrderId" value={testOrder} />
          <input type="hidden" name="visitId" value={linkedTest?.visitId ?? initialVisitId} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="space-y-4">
            {testOrders.length ? <div className="space-y-2"><Label htmlFor="report-test-order">Related ordered test (optional)</Label><Select value={testOrder || "none"} onValueChange={(value) => { const id = value === "none" ? "" : String(value); setTestOrder(id); const selected = testOrders.find((item) => item.id === id); if (selected) setPatient({ id: selected.patientId, label: selected.patientLabel }); }}><SelectTrigger id="report-test-order" className="w-full"><SelectValue placeholder="Not linked to an order">{() => testOrderLabel}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none" label="Not linked to an order">Not linked to an order</SelectItem>{testOrders.map((item) => <SelectItem key={item.id} value={item.id} label={item.label}>{item.label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-destructive">{state.fieldErrors?.testOrderId?.[0]}</p></div> : null}
            <div className="space-y-2">
              <Label htmlFor="report-patient">Patient</Label>
              {lockPatient ? (
                <Input id="report-patient" value={patient?.label ?? "Patient"} readOnly />
              ) : (
                <PatientCombobox
                  id="report-patient"
                  value={patient}
                  onChange={setPatient}
                />
              )}
              <p className="text-xs text-destructive">{state.fieldErrors?.patientId?.[0]}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-name">Report name</Label>
              <Input id="report-name" name="reportName" required />
              <p className="text-xs text-destructive">{state.fieldErrors?.reportName?.[0]}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="report-category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(String(value))}
                >
                  <SelectTrigger id="report-category" className="w-full">
                    <SelectValue placeholder="Select category">{() => categoryName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} label={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-destructive">{state.fieldErrors?.categoryId?.[0]}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-date">Report date</Label>
                <DatePickerField
                  id="report-date"
                  name="reportDate"
                  value={reportDate}
                  onValueChange={setReportDate}
                  disableFuture
                />
                <p className="text-xs text-destructive">{state.fieldErrors?.reportDate?.[0]}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-file">File</Label>
              <Input
                id="report-file"
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                required
              />
              <p className="text-xs text-destructive">
                {state.fieldErrors?.file?.[0]}
              </p>
              <p className="text-xs text-muted-foreground">
                Maximum 1 MB. Large camera images are resized locally before upload; PDFs over 1 MB are rejected.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-notes">Notes</Label>
              <Textarea id="report-notes" name="notes" rows={2} />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending || !patient?.id || !category} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <FileUp />}{" "}
              Upload Privately
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
