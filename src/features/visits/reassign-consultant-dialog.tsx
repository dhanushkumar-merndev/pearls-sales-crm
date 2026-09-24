"use client";
import { useActionState, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { reassignVisitConsultant } from "./actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";
type Doctor = { id: string; label: string };
export function ReassignConsultantDialog({
  visitId,
  token,
  currentDoctorId,
  currentDoctorName,
  doctors,
}: {
  visitId: string;
  token: number;
  currentDoctorId: string;
  currentDoctorName: string;
  doctors: Doctor[];
}) {
  const [state, action, pending] = useActionState(reassignVisitConsultant, {
    ok: false,
  } as ActionState);
  const [doctorId, setDoctorId] = useState("");
  const { open, setOpen } = useAutoCloseDialog(
    state,
    "Consultant changed. The daily token number is unchanged.",
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <RefreshCw /> Change consultant
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Change consultant</DialogTitle>
            <DialogDescription>
              Token #{token} remains unchanged. Current consultant:{" "}
              {currentDoctorName}.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="doctorId" value={doctorId} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New consultant</Label>
              <Select
                value={doctorId}
                onValueChange={(value) => setDoctorId(String(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select consultant">{() => doctors.find((doctor) => doctor.id === doctorId)?.label ?? "Select consultant"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {doctors
                    .filter((doctor) => doctor.id !== currentDoctorId)
                    .map((doctor) => (
                      <SelectItem key={doctor.id} value={doctor.id} label={doctor.label}>
                        {doctor.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-destructive">
                {state.fieldErrors?.doctorId?.[0]}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`reassign-reason-${visitId}`}>Reason</Label>
              <Textarea
                id={`reassign-reason-${visitId}`}
                name="reason"
                placeholder="Doctor unavailable, emergency absence…"
                required
                rows={3}
              />
              <p className="text-xs text-destructive">
                {state.fieldErrors?.reason?.[0]}
              </p>
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending || !doctorId}>
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}{" "}
              Change consultant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
