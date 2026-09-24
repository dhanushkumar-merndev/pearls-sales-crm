"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { LoaderCircle, Plus, Printer, X } from "lucide-react";
import { createVisit } from "./actions";
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
import { DoctorLoad } from "@/features/reception/doctor-load";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type DoctorOption = {
  /** Current load, when the caller fetched it (list_doctor_workload). */
  opActive?: number | undefined;
  id: string;
  displayName: string;
  department: string;
  opFeePaise: number;
  followUpFeePaise: number;
};
type VisitOption = { id: string; label: string };
const initial: ActionState = { ok: false };

export function CreateVisitDialog({
  patientId,
  patientName,
  doctors,
  previousVisits,
  existingVisitId,
}: {
  patientId: string;
  patientName: string;
  doctors: DoctorOption[];
  previousVisits: VisitOption[];
  /** Keeps an open success dialog mounted when a lead becomes converted. */
  existingVisitId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [visitType, setVisitType] = useState("op");
  const [previousVisitId, setPreviousVisitId] = useState("");
  // A patient may see more than one consultant in the same sitting. Each gets a
  // token from their own daily series (AGENTS.md 15), which the server handles;
  // this just collects who they are.
  const [additionalDoctors, setAdditionalDoctors] = useState<Array<{ key: string; doctorId: string }>>([]);
  // Regenerated after every completed visit: create_visit_with_token treats a
  // repeated key as a replay and hands back the FIRST visit, so a second
  // registration would silently reuse the first token.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // useActionState keeps the last result forever, which left the dialog stuck on
  // the success panel; acknowledging it on close brings the form back.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [state, action, pending] = useActionState(createVisit, initial);
  const doctor = useMemo(
    () => doctors.find((item) => item.id === doctorId),
    [doctors, doctorId],
  );

  // No fee is captured at registration: the consulting doctor sets it when the
  // consultation is completed, and reception or pharmacy collects it afterwards.
  function updateVisitType(nextVisitType: string) {
    setVisitType(nextVisitType);
  }

  function updateDoctor(nextDoctorId: string) {
    setDoctorId(nextDoctorId);
  }

  const showSuccess = state.ok && state.data?.visitId !== acknowledged;
  const consultants = [{ doctorId }, ...additionalDoctors.map((entry) => ({ doctorId: entry.doctorId }))];
  const departmentOf = (id: string) => doctors.find((item) => item.id === id)?.department ?? "—";
  const unusedDoctor = () => doctors.find((item) => !consultants.some((entry) => entry.doctorId === item.id));

  if (existingVisitId && !open) return <Button size="sm" variant="outline" render={<Link href={`/visits/${existingVisitId}`} />}>Open visit</Button>;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAcknowledged((state.data?.visitId as string | undefined) ?? null);
          setIdempotencyKey(crypto.randomUUID());
          setAdditionalDoctors([]);
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus /> Create Visit
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {showSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle>Visit created</DialogTitle>
              <DialogDescription>
                {patientName} has been added to the doctor queue.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-secondary p-6 text-center">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Token number
              </p>
              <p className="mt-1 text-5xl font-bold text-primary">
                {state.data?.token}
              </p>
              {/* With more than one consultant every doctor issues their own
                  token, so the full list matters -- the big number above is
                  only the first. */}
              {state.message && state.message.includes("token #") ? (
                <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                render={<Link href={`/print/token/${state.data?.visitId}`} />}
              >
                <Printer /> Print Token
              </Button>
              <Button render={<Link href={`/visits/${state.data?.visitId}`} />}>
                Open Visit
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={action} className="contents">
            <DialogHeader>
              <DialogTitle>Create visit</DialogTitle>
              <DialogDescription>
                Token generation is atomic. The consultant sets the fee during
                the consultation; it is collected afterwards at the pharmacy or
                billing counter.
              </DialogDescription>
            </DialogHeader>
            {state.message ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {state.message}
              </p>
            ) : null}
            <input type="hidden" name="patientId" value={patientId} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input type="hidden" name="doctorId" value={doctorId} />
            <input type="hidden" name="visitType" value={visitType} />
            <input type="hidden" name="consultants" value={JSON.stringify(consultants)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Patient</Label>
                <Input value={patientName} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visit-type">Visit type</Label>
                <Select
                  value={visitType}
                  onValueChange={(value) => updateVisitType(String(value))}
                >
                  <SelectTrigger id="visit-type" className="w-full">
                    {/* Without a render function the trigger shows the stored
                        value ("op") rather than the label staff chose. */}
                    <SelectValue>{() => (visitType === "op" ? "OP" : "Follow-up")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="op" label="OP">
                      OP
                    </SelectItem>
                    <SelectItem value="follow_up" label="Follow-up">
                      Follow-up
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="visit-doctor">Doctor</Label>
                <Select
                  value={doctorId}
                  onValueChange={(value) => updateDoctor(String(value))}
                >
                  <SelectTrigger id="visit-doctor" className="w-full">
                    <SelectValue placeholder="Select doctor">
                      {() => doctor?.displayName ?? "Select doctor"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.id}
                        label={item.displayName}
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{item.displayName}</span>
                          <DoctorLoad
                            opActive={item.opActive}
                          />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="visit-department">Department</Label>
                {/* Filled from the doctor: the department is a property of the
                    consultant, never chosen separately. */}
                <Input
                  id="visit-department"
                  value={doctor?.department ?? "—"}
                  readOnly
                />
              </div>
              {additionalDoctors.map((entry, index) => (
                <div
                  className="grid gap-4 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2"
                  key={entry.key}
                >
                  <div className="flex items-center justify-between sm:col-span-2">
                    <p className="font-medium">Additional doctor {index + 2}</p>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove additional doctor ${index + 2}`}
                      onClick={() =>
                        setAdditionalDoctors((rows) => rows.filter((row) => row.key !== entry.key))
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`visit-doctor-${entry.key}`}>Doctor</Label>
                    <Select
                      value={entry.doctorId}
                      onValueChange={(value) =>
                        setAdditionalDoctors((rows) =>
                          rows.map((row) =>
                            row.key === entry.key ? { ...row, doctorId: String(value) } : row,
                          ),
                        )
                      }
                    >
                      <SelectTrigger id={`visit-doctor-${entry.key}`} className="w-full">
                        <SelectValue placeholder="Select doctor">
                          {() =>
                            doctors.find((item) => item.id === entry.doctorId)?.displayName ??
                            "Select doctor"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {doctors
                          .filter(
                            (item) =>
                              item.id === entry.doctorId ||
                              !consultants.some((consultant) => consultant.doctorId === item.id),
                          )
                          .map((item) => (
                            <SelectItem key={item.id} value={item.id} label={item.displayName}>
                              {item.displayName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`visit-department-${entry.key}`}>Department</Label>
                    <Input
                      id={`visit-department-${entry.key}`}
                      value={departmentOf(entry.doctorId)}
                      readOnly
                    />
                  </div>
                </div>
              ))}
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={consultants.length >= doctors.length}
                  onClick={() => {
                    const next = unusedDoctor();
                    if (!next) return;
                    setAdditionalDoctors((rows) => [
                      ...rows,
                      { key: crypto.randomUUID(), doctorId: next.id },
                    ]);
                  }}
                >
                  <Plus /> Add another doctor
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Each consultant issues a token from their own series for today.
                </p>
              </div>
              {visitType === "follow_up" ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="previous-visit">Related previous visit</Label>
                  <input
                    type="hidden"
                    name="previousVisitId"
                    value={previousVisitId}
                  />
                  <Select
                    value={previousVisitId}
                    onValueChange={(value) =>
                      setPreviousVisitId(value as string)
                    }
                  >
                    <SelectTrigger id="previous-visit" className="w-full">
                      <SelectValue placeholder="Select previous visit">{() => previousVisits.find((item) => item.id === previousVisitId)?.label ?? "Select previous visit"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {previousVisits.map((item) => (
                        <SelectItem key={item.id} value={item.id} label={item.label}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-destructive">
                    {state.fieldErrors?.previousVisitId?.[0]}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="visit-notes">Notes</Label>
                <Textarea id="visit-notes" name="notes" rows={2} />
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button disabled={pending || !doctorId} type="submit">
                {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
                Create Visit
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
