"use client";
import { useActionState } from "react";
import { Activity, LoaderCircle } from "lucide-react";
import { saveVitals } from "./actions";
import type { ActionState } from "@/types/hospital";
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
import { Textarea } from "@/components/ui/textarea";
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";

const initial: ActionState = { ok: false };
export function VitalsDialog({
  visitId,
  patientName,
  initialVitals,
}: {
  visitId: string;
  patientName: string;
  initialVitals?: Record<string, number | string | null>;
}) {
  const [state, action, pending] = useActionState(saveVitals, initial);
  const { open, setOpen } = useAutoCloseDialog(state, "Vitals saved and patient marked ready.");
  const fields = [
    ["weight", "Weight (kg)", "0.1", "0.1", undefined],
    ["height", "Height (cm)", "0.1", "0.1", undefined],
    ["temperature", "Temperature (°F)", "0.1", "80", "115"],
    ["systolic", "BP systolic", "1", "1", undefined],
    ["diastolic", "BP diastolic", "1", "1", undefined],
    ["pulse", "Pulse / min", "1", "1", undefined],
    ["spo2", "SpO₂ (%)", "1", "1", "100"],
    ["respiratoryRate", "Respiratory rate", "1", "1", undefined],
  ] as const;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Activity /> Record Vitals
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Record vitals</DialogTitle>
            <DialogDescription>
              {patientName} · saving marks the patient ready for the doctor.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="visitId" value={visitId} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([name, label, step, min, max]) => (
              <div className="space-y-2" key={name}>
                <Label htmlFor={`${visitId}-${name}`}>{label}</Label>
                <Input
                  id={`${visitId}-${name}`}
                  name={name}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={initialVitals?.[name] ?? ""}
                />
                <p className="text-xs text-destructive">
                  {state.fieldErrors?.[name]?.[0]}
                </p>
              </div>
            ))}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${visitId}-notes`}>Notes</Label>
              <Textarea
                id={`${visitId}-notes`}
                name="notes"
                defaultValue={String(initialVitals?.notes ?? "")}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending} type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Activity />
              )}{" "}
              Save & Mark Ready
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
