"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import type { ActionState } from "@/types/hospital";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createManualLead, addLeadNote, updateLeadStatus, bookLeadAppointment, assignLead } from "./actions";
import type { Lead, Owner, PatientMatch } from "./schema";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;
function ActionForm({ action, label, children }: { action: Action; label: string; children: React.ReactNode }) {
  const [state, submit, pending] = useActionState(action, { ok: false });
  return <form action={submit} className="space-y-3"><fieldset disabled={pending} className="min-w-0 space-y-3">{children}</fieldset>
    {state.message || state.fieldErrors ? <Alert variant={state.ok ? "default" : "destructive"}><AlertDescription role="status">{state.message}{state.fieldErrors ? <ul>{Object.entries(state.fieldErrors).map(([field, errors]) => <li key={field}>{errors.join(" ")}</li>)}</ul> : null}</AlertDescription></Alert> : null}
    {state.ok && typeof state.data?.leadId === "string" ? <Button render={<Link href={`/leads/${state.data.leadId}`} />}>Open enquiry</Button> : <Button type="submit" disabled={pending}>{pending ? "Saving…" : label}</Button>}
  </form>;
}
export function Choice({ name, label, options, defaultValue }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Select name={name} defaultValue={defaultValue ?? options[0]?.value}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value} label={o.label}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}
function Field({ label, name, type = "text", value, required, maxLength }: { label: string; name: string; type?: string; value?: string; required?: boolean; maxLength?: number }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} name={name} type={type} defaultValue={value} required={required} maxLength={maxLength} /></div>;
}
function Note({ name = "note", label = "Note" }: { name?: string; label?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Textarea id={id} name={name} maxLength={4000} rows={3} /></div>;
}
export function NewLeadDialog({ owners }: { owners: Owner[] }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button className="w-full sm:w-auto" />}>Add enquiry</DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>New enquiry</DialogTitle><DialogDescription>Add a phone or walk-in enquiry to the sales queue.</DialogDescription></DialogHeader>{open ? <NewLeadForm owners={owners} /> : null}</DialogContent></Dialog>;
}
function NewLeadForm({ owners }: { owners: Owner[] }) {
  const [key] = useState(() => crypto.randomUUID());
  return <ActionForm action={createManualLead} label="Create enquiry"><input type="hidden" name="idempotencyKey" value={key} />
    <Field label="Full name" name="fullName" required maxLength={160} /><Field label="Mobile number" name="phone" type="tel" required maxLength={40} />
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Email" name="email" type="email" maxLength={254} /><Field label="City" name="city" maxLength={120} /></div>
    <Field label="Procedure of interest" name="procedureInterest" maxLength={200} /><Note name="message" label="Enquiry details" />
    {owners.length ? <Choice label="Assign to" name="assignTo" options={[{ value: "", label: "Automatic assignment" }, ...owners.map((o) => ({ value: o.id, label: o.full_name }))]} /> : null}
  </ActionForm>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}
export function LeadForms({ lead, owners, matches, isAdmin }: { lead: Lead; owners: Owner[]; matches: PatientMatch[]; isAdmin: boolean }) {
  const id = <input type="hidden" name="leadId" value={lead.id} />;
  const clearId = useId();
  const closed = lead.status === "converted";
  return <div className="grid items-start gap-4 lg:grid-cols-2">
    <Panel title="Log a call or note"><ActionForm action={addLeadNote} label="Save activity">{id}
      <Choice label="Activity" name="type" options={[{ value: "call", label: "Call" }, { value: "note", label: "Note" }]} /><Note name="body" label="Call outcome / note" />
      {!closed ? <><Field label="Next follow-up (IST)" name="nextFollowUpAt" type="datetime-local" /><div className="flex items-center gap-2"><Checkbox id={clearId} name="clearFollowUp" /><Label htmlFor={clearId}>Clear scheduled follow-up</Label></div></> : null}
    </ActionForm></Panel>
    {!closed ? <Panel title="Update status"><ActionForm action={updateLeadStatus} label="Save status">{id}
      <Choice label="Status" name="status" defaultValue={lead.status === "lost" ? "lost" : "contacted"} options={[{ value: "contacted", label: "Contacted" }, { value: "interested", label: "Interested" }, { value: "lost", label: "Lost" }]} />
      {lead.status === "booked" ? <p className="text-sm text-muted-foreground">Changing status releases the current appointment.</p> : null}
      <Field label="Lost reason (required when lost)" name="lostReason" maxLength={500} /><Field label="Next follow-up (IST)" name="nextFollowUpAt" type="datetime-local" /><Note />
    </ActionForm></Panel> : null}
    {!closed ? <Panel title={lead.status === "booked" ? "Reschedule appointment" : "Book appointment"}>{lead.phone_normalized ? <ActionForm action={bookLeadAppointment} label="Book appointment">{id}
      <Field label="Appointment (IST)" name="appointmentAt" type="datetime-local" required />
      {matches.length ? <Choice label="Patient" name="patientId" defaultValue={lead.patient_id ?? matches[0].patient_id} options={[...matches.map((m) => ({ value: m.patient_id, label: `${m.name} · ${m.uhid}` })), ...(!lead.patient_id ? [{ value: "", label: "Register a different family member" }] : [])]} /> : null}
      <Field label="Patient name" name="patientName" value={lead.full_name ?? ""} required maxLength={160} />
      <Choice label="Gender" name="gender" options={[{ value: "unknown", label: "Not specified" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }]} /><Note />
      <p className="text-xs text-muted-foreground">Reception creates the visit and token on arrival.</p>
    </ActionForm> : <p className="text-sm text-muted-foreground">A valid Indian mobile number is needed to book this enquiry.</p>}</Panel> : null}
    {isAdmin ? <Panel title="Sales executive"><ActionForm action={assignLead} label="Update assignment">{id}<Choice label="Assigned to" name="profileId" defaultValue={lead.assigned_to ?? ""} options={[{ value: "", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.full_name }))]} /></ActionForm></Panel> : null}
  </div>;
}
