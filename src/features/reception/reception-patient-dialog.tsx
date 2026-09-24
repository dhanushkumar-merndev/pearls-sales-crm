"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  LoaderCircle,
  Plus,
  Printer,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { registerPatientWithVisit } from "./actions";
import { createVisit } from "@/features/visits/actions";
import type { ActionState } from "@/types/hospital";
import { AllergyTagInput } from "@/features/patients/allergy-tag-input";
import { calculateAge } from "@/lib/domain/date";
import { SEARCH_DEBOUNCE_MS } from "@/lib/domain/search";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { LocationAutocomplete } from "@/components/shared/location-autocomplete";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DoctorLoad } from "./doctor-load";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type Doctor = {
  id: string;
  displayName: string;
  department: string;
  opFeePaise: number;
  followUpFeePaise: number;
  /** Current load, when the caller fetched it (list_doctor_workload). */
  opActive?: number | undefined;
};
type Patient = {
  id: string;
  name: string;
  uhid: string | null;
  phone_normalized: string;
  dob: string | null;
  gender: string;
};
type Consultant = { key: string; doctorId: string };
const initial: ActionState = { ok: false };
const GENDER_LABELS: Record<string, string> = { unknown: "Not specified", male: "Male", female: "Female", other: "Other" };

export function ReceptionPatientDialog({ doctors }: { doctors: Doctor[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"search" | "add" | "visit">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [fullDetails, setFullDetails] = useState(false);
  const [newDob, setNewDob] = useState("");
  const [newAge, setNewAge] = useState("");
  const [newGender, setNewGender] = useState("unknown");
  const [newBloodGroup, setNewBloodGroup] = useState("");
  // Registering a new patient saves the patient AND their first visit in one
  // submit; an existing patient picked from the search only needs the visit.
  const [registerState, registerAction, registerPending] = useActionState(
    registerPatientWithVisit,
    initial,
  );
  const [visitState, visitAction, visitPending] = useActionState(
    createVisit,
    initial,
  );
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [visitType, setVisitType] = useState("op");
  const [additionalDoctors, setAdditionalDoctors] = useState<Consultant[]>([]);
  // A repeated idempotency key makes create_visit_with_token return the first
  // visit again, so registering the next patient would show a token that
  // belongs to the previous one. Fresh key per registration.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [handledPatientId, setHandledPatientId] = useState<string | null>(null);
  const doctor = useMemo(
    () => doctors.find((item) => item.id === doctorId),
    [doctorId, doctors],
  );
  const consultants = [{ doctorId }, ...additionalDoctors.map(({ doctorId: id }) => ({ doctorId: id }))];

  useEffect(() => {
    if (!open || step !== "search" || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/search/patients?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (response.ok) setResults(body.items ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort();
    };
  }, [open, query, step]);

  useEffect(() => {
    const patientId = registerState.data?.patientId;
    // useActionState holds the last result indefinitely, and this effect also
    // depends on the typed name and phone. Without the handled check, starting a
    // SECOND registration re-fires the previous result carrying the FIRST
    // patient's id.
    if (typeof patientId !== "string" || patientId === handledPatientId) return;
    // The server action result is the external event that advances this workflow.
    /* eslint-disable react-hooks/set-state-in-effect */
    setHandledPatientId(patientId);
    setSelected({
      id: patientId,
      name: newName.trim(),
      uhid: (registerState.data?.uhid as string | undefined) ?? null,
      phone_normalized: newPhone.replace(/\D/g, "").slice(-10),
      dob: null,
      gender: "unknown",
    });
    // The patient was saved but the token was not. They are in the register now,
    // so drop into the visit step rather than making reception retype them.
    if (!registerState.ok) setStep("visit");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [registerState, newName, newPhone, handledPatientId]);

  function choosePatient(patient: Patient) {
    setSelected(patient);
    setStep("visit");
  }
  function reset() {
    setAcknowledged(successState.data?.visitId as string | undefined ?? null);
    setIdempotencyKey(crypto.randomUUID());
    setStep("search");
    setSelected(null);
    setQuery("");
    setNewName("");
    setNewPhone("");
    setNewDob("");
    setNewAge("");
    setNewGender("unknown");
    setNewBloodGroup("");
    setFullDetails(false);
    setAdditionalDoctors([]);
    setResults([]);
  }

  // Either form can be the one that produced the token.
  const successState = registerState.data?.visitId ? registerState : visitState;
  const showVisitSuccess =
    successState.ok && successState.data?.visitId !== acknowledged;
  const departmentOf = (id: string) =>
    doctors.find((item) => item.id === id)?.department ?? "—";

  /** Consultant, department and notes: identical for a new and an existing patient. */
  const visitFields = (idPrefix: string, allowFollowUp: boolean) => (
    <>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="visitType" value={visitType} />
      <input type="hidden" name="consultants" value={JSON.stringify(consultants)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-visit-type`}>Visit type</Label>
          <Select value={visitType} onValueChange={(value) => setVisitType(String(value))}>
            <SelectTrigger id={`${idPrefix}-visit-type`} className="w-full">
              {/* Without a render function the trigger shows the stored value
                  ("op") rather than the label staff chose. */}
              <SelectValue>{() => (visitType === "op" ? "OP" : "Follow-up")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="op" label="OP">
                OP
              </SelectItem>
              <SelectItem value="follow_up" label="Follow-up" disabled={!allowFollowUp}>
                Follow-up (open patient history)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-doctor`}>Doctor</Label>
          <Select value={doctorId} onValueChange={(value) => setDoctorId(String(value))}>
            <SelectTrigger id={`${idPrefix}-doctor`} className="w-full">
              <SelectValue>{() => doctor?.displayName ?? "Select doctor"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {doctors.map((item) => (
                <SelectItem key={item.id} value={item.id} label={item.displayName}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{item.displayName}</span>
                    <DoctorLoad opActive={item.opActive} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-department`}>Department</Label>
          {/* Filled from the doctor: the department belongs to the consultant. */}
          <Input id={`${idPrefix}-department`} value={doctor?.department ?? "—"} readOnly />
        </div>
        {additionalDoctors.map((entry, index) => (
          <div className="grid gap-4 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2" key={entry.key}>
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
              <Label htmlFor={`${idPrefix}-doctor-${entry.key}`}>Doctor</Label>
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
                <SelectTrigger id={`${idPrefix}-doctor-${entry.key}`} className="w-full">
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
              <Label htmlFor={`${idPrefix}-department-${entry.key}`}>Department</Label>
              <Input
                id={`${idPrefix}-department-${entry.key}`}
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
              const next = doctors.find(
                (item) => !consultants.some((consultant) => consultant.doctorId === item.id),
              );
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
        {/* No money is captured at registration: each consultant sets their own
            fee, collected later at the pharmacy or billing counter. */}
        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground sm:col-span-2">
          No payment is taken here. Each consultant sets their fee during the
          consultation, and it is collected afterwards at the pharmacy or billing
          counter — see Fees &amp; Payments.
        </p>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
          <Textarea id={`${idPrefix}-notes`} name="notes" rows={2} />
        </div>
      </div>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <UserPlus /> Find or Add Patient
      </DialogTrigger>
      <DialogContent className="flex h-[min(680px,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-2xl">
        {showVisitSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle>Visit created</DialogTitle>
              <DialogDescription>
                {selected?.name} has been added to the doctor queue.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full rounded-lg border bg-secondary p-8 text-center">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Token number
                </p>
                <p className="mt-1 text-6xl font-bold text-primary">
                  {successState.data?.token}
                </p>
                {/* With more than one consultant each doctor issues their own
                    token, so the full list matters. */}
                {successState.message?.includes("token #") ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {successState.message}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                render={
                  <Link href={`/print/token/${successState.data?.visitId}`} />
                }
              >
                <Printer /> Print Token
              </Button>
              <Button
                render={<Link href={`/visits/${successState.data?.visitId}`} />}
              >
                Open Visit
              </Button>
            </DialogFooter>
          </>
        ) : step === "search" ? (
          <>
            <DialogHeader>
              <DialogTitle>Find or add patient</DialogTitle>
              <DialogDescription>
                Search by UHID, mobile number or name. Results appear after 500 ms.
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="UHID, mobile number or patient name"
                autoFocus
              />
              {searching ? (
                <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1">
              {results.length ? (
                results.map((patient) => (
                  <button
                    type="button"
                    key={patient.id}
                    onClick={() => choosePatient(patient)}
                    className="flex w-full items-center justify-between gap-3 border-b p-3 text-left last:border-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block font-medium">{patient.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {/* UHID is the Patient ID: a family shares one mobile
                            number, so the number alone identifies nobody. */}
                        {patient.uhid ?? "—"} · {patient.phone_normalized}
                      </span>
                    </span>
                    {!patient.dob || patient.gender === "unknown" ? (
                      <Badge variant="outline">Details pending</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Select
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="flex h-full min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {query.trim().length < 2
                    ? "Enter at least 2 characters to search."
                    : searching
                      ? "Searching patients…"
                      : "No matching patient. Add a quick patient record below."}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setNewName(/\D/.test(query) ? query : "");
                  setNewPhone(/^\d/.test(query) ? query : "");
                  setStep("add");
                }}
              >
                <Plus /> Add new patient
              </Button>
            </DialogFooter>
          </>
        ) : step === "add" ? (
          /* A first-time patient always needs a visit, so both are captured in
             one form and saved together: one submit, one token. */
          <form action={registerAction} className="contents">
            <DialogHeader>
              <DialogTitle>New patient &amp; visit</DialogTitle>
              <DialogDescription>
                Registers the patient and issues the token in one step. Date of
                birth, gender, address and clinical details can be completed
                later and will be marked pending.
              </DialogDescription>
            </DialogHeader>
            {registerState.message && !registerState.ok ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {registerState.message}
              </p>
            ) : null}
            <div className="dialog-scroll space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quick-name">Patient name *</Label>
                <Input
                  id="quick-name"
                  name="name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  required
                  autoFocus
                />
                <p className="text-xs text-destructive">
                  {registerState.fieldErrors?.name?.[0]}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-phone">Mobile number *</Label>
                <Input
                  id="quick-phone"
                  name="phone"
                  inputMode="numeric"
                  value={newPhone}
                  onChange={(event) => setNewPhone(event.target.value)}
                  placeholder="9876543210"
                  required
                />
                <p className="text-xs text-destructive">
                  {registerState.fieldErrors?.phone?.[0]}
                </p>
              </div>
              {/* Registration is deliberately two fields long so a queue keeps
                  moving, but when the patient is standing there with time to
                  spare the rest can be captured now instead of being chased
                  later from the pending row. */}
              <label className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  checked={fullDetails}
                  onCheckedChange={(checked) => setFullDetails(checked === true)}
                />
                <span className="text-sm">
                  <span className="font-medium">Fill the full details now</span>
                  <span className="mt-1 block text-muted-foreground">
                    Date of birth, gender, blood group, address and allergies. Leave it
                    unticked to register in two fields and complete the rest later.
                  </span>
                </span>
              </label>

              {fullDetails ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="quick-dob">Date of birth</Label>
                    <DatePickerField
                      id="quick-dob"
                      name="dob"
                      value={newDob}
                      onValueChange={(value) => {
                        setNewDob(value);
                        setNewAge(value ? String(calculateAge(value)) : "");
                      }}
                      placeholder="Select date of birth"
                      disableFuture
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-age">Age</Label>
                    <Input
                      id="quick-age"
                      name="age"
                      inputMode="numeric"
                      placeholder="32"
                      value={newAge}
                      onChange={(event) => {
                        setNewAge(event.target.value);
                        if (event.target.value.trim()) setNewDob("");
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-gender">Gender</Label>
                    <Select value={newGender} onValueChange={(value) => setNewGender(String(value))}>
                      <SelectTrigger id="quick-gender" className="w-full">
                        <SelectValue>{() => GENDER_LABELS[newGender] ?? newGender}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Not specified</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-blood">Blood group</Label>
                    <Select value={newBloodGroup} onValueChange={(value) => setNewBloodGroup(String(value))}>
                      <SelectTrigger id="quick-blood" className="w-full">
                        <SelectValue placeholder="Not known">{() => newBloodGroup || "Not known"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Not known</SelectItem>
                        {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((group) => (
                          <SelectItem key={group} value={group}>
                            {group}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="quick-address">Place / Address</Label>
                    <LocationAutocomplete id="quick-address" name="address" rows={2} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="quick-allergies">Allergic history</Label>
                    <AllergyTagInput id="quick-allergies" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="quick-reference">Reference detail</Label>
                    <Input
                      id="quick-reference"
                      name="referenceDetail"
                      placeholder="Referred by Dr Kumar / health camp / walk-in"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border bg-muted/50 p-3 text-sm">
                  <Badge variant="outline">Details pending</Badge>
                  <p className="mt-2 text-muted-foreground">
                    Reception can complete the remaining patient details from the
                    pending row after the visit is created.
                  </p>
                </div>
              )}
              <input type="hidden" name="gender" value={fullDetails ? newGender : "unknown"} />
              <input type="hidden" name="bloodGroup" value={fullDetails ? newBloodGroup : ""} />

              <Separator />
              <div className="space-y-1">
                <p className="font-medium">Visit details</p>
                <p className="text-sm text-muted-foreground">
                  The token is issued as soon as the patient is saved.
                </p>
              </div>
              {/* A first visit has no earlier visit to link to, so follow-up is
                  only offered once the patient exists. */}
              {visitFields("new", false)}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("search")}
              >
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" disabled={registerPending || !doctorId}>
                {registerPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                Register &amp; Create Visit
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form action={visitAction} className="contents">
            <DialogHeader>
              <DialogTitle>Create visit</DialogTitle>
              <DialogDescription>
                Token generation is atomic. The consultant sets the fee during
                the consultation; it is collected afterwards at the pharmacy or
                billing counter.
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="patientId" value={selected?.id ?? ""} />
            {visitState.message ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {visitState.message}
              </p>
            ) : null}
            <div className="dialog-scroll space-y-4">
              <div className="space-y-2">
                <Label>Patient</Label>
                <div className="flex h-10 items-center justify-between rounded-md border bg-muted/40 px-3">
                  <span>
                    {selected?.name} · {selected?.uhid ?? "—"} ·{" "}
                    {selected?.phone_normalized}
                  </span>
                  {!selected?.dob || selected.gender === "unknown" ? (
                    <Badge variant="outline">Details pending</Badge>
                  ) : null}
                </div>
              </div>
              {visitFields("reception", false)}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("search")}
              >
                <ArrowLeft /> Change patient
              </Button>
              <Button type="submit" disabled={visitPending || !doctorId}>
                {visitPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                Create Visit
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
