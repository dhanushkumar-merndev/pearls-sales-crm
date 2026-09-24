"use client";

import { useActionState, useEffect, useState } from "react";
import { LoaderCircle, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { updatePatientAllergies } from "./actions";
import { AllergyTagInput } from "./allergy-tag-input";
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
import { Label } from "@/components/ui/label";

const initial: ActionState = { ok: false };

/**
 * Allergy entry from wherever the allergy is discovered — usually the
 * consultation, which is why this is not buried inside Edit Patient.
 */
export function AllergyDialog({
  patientId,
  patientName,
  allergies,
  triggerLabel = "Allergies",
}: {
  patientId: string;
  patientName: string;
  allergies: string | null;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<ActionState | null>(null);
  const [state, action, pending] = useActionState(updatePatientAllergies, initial);

  // useActionState keeps the last result forever; comparing against the
  // acknowledged one closes the dialog once per save instead of on every render.
  const saved = state.ok && state !== acknowledged;
  useEffect(() => {
    if (!saved) return;
    toast.success(state.message ?? "Allergies updated.");
    // The server result is the external event that closes this dialog.
    /* eslint-disable react-hooks/set-state-in-effect */
    setAcknowledged(state);
    setOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [saved, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* xs is the closest Button size to the h-5 Badge row it sits in
          alongside (Status/Age/Doctor/Rx badges) -- true pixel parity would
          need a non-Button trigger, which isn't worth losing the click target for. */}
      <DialogTrigger render={<Button size="xs" variant={allergies ? "destructive" : "outline"} />}>
        <TriangleAlert /> {allergies ? "Edit allergies" : triggerLabel}
      </DialogTrigger>
      <DialogContent className="flex max-h-[70dvh] flex-col overflow-hidden sm:max-w-lg">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Allergic history</DialogTitle>
            <DialogDescription>
              {patientName} · shown as a warning on the visit, prescription and
              patient record.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="patientId" value={patientId} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="dialog-scroll space-y-2">
            <Label htmlFor="allergy-tags">Allergies</Label>
            {/* Remounted per open so a cancelled edit does not linger. */}
            <AllergyTagInput
              key={open ? "open" : "closed"}
              id="allergy-tags"
              initialValue={allergies ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to record that the patient has no known allergies.
            </p>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Save />} Save
              Allergies
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
