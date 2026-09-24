"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { createPatient } from "./actions";
import type { ActionState } from "@/types/hospital";
import { calculateAge } from "@/lib/domain/date";
import { AllergyTagInput } from "./allergy-tag-input";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { LocationAutocomplete } from "@/components/shared/location-autocomplete";
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

const initial: ActionState = { ok: false };
const GENDER_LABELS: Record<string, string> = { unknown: "Not specified", male: "Male", female: "Female", other: "Other" };
const ErrorText = ({ errors }: { errors?: string[] }) =>
  errors?.map((item) => (
    <p className="text-xs text-destructive" key={item}>
      {item}
    </p>
  ));

export function NewPatientDialog() {
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState("unknown");
  const [bloodGroup, setBloodGroup] = useState("");
  const [dob, setDob] = useState("");
  const [age, setAge] = useState("");
  const [state, action, pending] = useActionState(createPatient, initial);
  const router = useRouter();
  useEffect(() => {
    if (state.ok && state.data?.patientId) {
      toast.success("Patient created");
      router.push(`/patients/${state.data.patientId}`);
    }
  }, [state, router]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> Add Patient
      </DialogTrigger>
      {/* Capped at 70% of the viewport and centred: the form is long enough to
          fill a laptop screen otherwise. Only the fields scroll -- the title and
          the Create Patient button stay put. */}
      <DialogContent className="flex max-h-[70dvh] flex-col overflow-hidden sm:max-w-xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Add patient</DialogTitle>
            <DialogDescription>
              UHID is the Patient ID. Leave it blank to auto-generate. Several
              patients may share one phone number.
            </DialogDescription>
          </DialogHeader>
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="dialog-scroll">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="patient-name">Name *</Label>
                <Input id="patient-name" name="name" required autoFocus />
                <ErrorText errors={state.fieldErrors?.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-uhid">UHID</Label>
                <Input
                  id="patient-uhid"
                  name="uhid"
                  placeholder="Auto (MH-000123)"
                />
                <ErrorText errors={state.fieldErrors?.uhid} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-phone">Mobile number *</Label>
                <Input
                  id="patient-phone"
                  name="phone"
                  inputMode="numeric"
                  placeholder="9876543210"
                  required
                />
                <ErrorText errors={state.fieldErrors?.phone} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-dob">Date of birth</Label>
                <DatePickerField
                  id="patient-dob"
                  name="dob"
                  value={dob}
                  onValueChange={(value) => {
                    setDob(value);
                    // Picking a birth date fills the age in, so staff can
                    // sanity-check the date they just chose.
                    setAge(value ? String(calculateAge(value)) : "");
                  }}
                  placeholder="Select date of birth"
                  disableFuture
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-age">Age</Label>
                {/* Age and date of birth are two ways of saying the same thing,
                    and either can be typed. The server keeps the date when one
                    is set, so typing an age clears the date -- otherwise the
                    typed age would be silently discarded. Whichever field was
                    touched last is the one that is saved. */}
                <Input
                  id="patient-age"
                  name="age"
                  inputMode="numeric"
                  placeholder="32"
                  value={age}
                  onChange={(event) => {
                    setAge(event.target.value);
                    if (event.target.value.trim()) setDob("");
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {dob
                    ? "Calculated from the date of birth. Type an age to use that instead."
                    : age.trim()
                      ? "Saved as an approximate date of birth."
                      : "Enter either a date of birth or an age."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <input type="hidden" name="gender" value={gender} />
                <Select
                  value={gender}
                  onValueChange={(value) => setGender(value as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{() => GENDER_LABELS[gender] ?? gender}</SelectValue>
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
                <Label>Blood group</Label>
                <input type="hidden" name="bloodGroup" value={bloodGroup} />
                <Select
                  value={bloodGroup}
                  onValueChange={(value) => setBloodGroup(String(value))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{() => bloodGroup || "Not known"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Not known</SelectItem>
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                      (group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">Place / Address</Label>
                <LocationAutocomplete id="address" name="address" rows={2} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="allergies">Allergic history</Label>
                <AllergyTagInput id="allergies" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="reference-detail">Reference detail</Label>
                <Input
                  id="reference-detail"
                  name="referenceDetail"
                  placeholder="Referred by Dr Kumar / health camp / walk-in"
                />
              </div>
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Create Patient
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
