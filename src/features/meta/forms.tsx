"use client";
import { useActionState, useId } from "react";
import type { ActionState } from "@/types/hospital";
import type { Owner } from "@/features/leads/schema";
import { Choice } from "@/features/leads/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { saveMetaCredentials, connectMetaPage, syncMetaForms, saveMetaForm, backfillMetaLeads } from "./actions";
import { CRM_FIELDS } from "./mapping";

type Action = (state: ActionState, data: FormData) => Promise<ActionState>;
function MetaForm({ action, label, children, paging = false }: { action: Action; label: string; children: React.ReactNode; paging?: boolean }) {
  const [state, submit, pending] = useActionState(action, { ok: false });
  const cursor = typeof state.data?.cursor === "string" ? state.data.cursor : "";
  return <form action={submit} className="space-y-3"><fieldset className="min-w-0 space-y-3" disabled={pending}>{children}</fieldset>{paging ? <input type="hidden" name="cursor" value={cursor} /> : null}
    {state.message ? <Alert variant={state.ok ? "default" : "destructive"}><AlertDescription role="status">{state.message}</AlertDescription></Alert> : null}
    <Button type="submit" disabled={pending} size="sm">{pending ? "Working…" : cursor ? "Continue next batch" : label}</Button></form>;
}
function Field({ label, name, type = "text", value }: { label: string; name: string; type?: string; value?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} name={name} type={type} defaultValue={value} autoComplete={type === "password" ? "new-password" : "off"} required /></div>;
}
export function MetaConnectionForms({ appId, enabled }: { appId: string | null; enabled: boolean }) {
  return <div className="grid items-start gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">App credentials</CardTitle></CardHeader><CardContent>{enabled ? <MetaForm action={saveMetaCredentials} label="Save credentials"><Field label="Meta app ID" name="appId" value={appId ?? ""} /><Field label="App secret" name="appSecret" type="password" /><Field label="Webhook verification token (24+ characters)" name="verifyToken" type="password" /><p className="text-xs text-muted-foreground">Saved secrets are encrypted and never displayed. Changing the app requires reconnecting pages.</p></MetaForm> : <p className="text-sm text-muted-foreground">Server integration settings need to be configured before connecting Meta.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Connect a Facebook page</CardTitle></CardHeader><CardContent>{enabled && appId ? <MetaForm action={connectMetaPage} label="Connect page"><Field label="Page ID" name="pageId" /><Field label="Page access token" name="accessToken" type="password" /><p className="text-xs text-muted-foreground">Use a token issued by the app above with access to this page’s leads and subscriptions.</p></MetaForm> : <p className="text-sm text-muted-foreground">Save the app credentials first.</p>}</CardContent></Card></div>;
}
export function SyncFormsButton({ pageId }: { pageId: string }) {
  return <MetaForm action={syncMetaForms} label="Sync forms" paging><input type="hidden" name="pageId" value={pageId} /></MetaForm>;
}
export type MetaFormRow = { form_id: string; name: string; page_id: string; active: boolean; assignment_mode: string; assign_to: string | null; field_mapping: Record<string, string>; questions: { key: string; label?: string }[]; default_procedure_interest: string | null };
const fieldLabels: Record<string, string> = { full_name: "Full name", phone_raw: "Mobile number", email: "Email", city: "City", procedure_interest: "Procedure of interest", preferred_date: "Preferred date", message: "Message", extra: "Keep as additional answer", ignore: "Ignore" };
const standardMapping: Record<string, string> = { full_name: "full_name", phone_number: "phone_raw", email: "email", city: "city" };
export function ConfigureMetaForm({ form, owners }: { form: MetaFormRow; owners: Owner[] }) {
  const activeId = useId();
  return <Dialog><DialogTrigger render={<Button size="sm" variant="outline" />}>Configure</DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{form.name}</DialogTitle><DialogDescription>Map the lead form’s answers and choose who receives its enquiries.</DialogDescription></DialogHeader>
    <MetaForm action={saveMetaForm} label="Save form"><input type="hidden" name="formId" value={form.form_id} /><Choice name="assignmentMode" label="Assignment" defaultValue={form.assignment_mode} options={[{ value: "round_robin", label: "Distribute across sales executives" }, { value: "specific", label: "Specific sales executive" }, { value: "unassigned", label: "Leave unassigned" }]} />
      <Choice name="assignTo" label="Sales executive (for specific assignment)" defaultValue={form.assign_to ?? ""} options={[{ value: "", label: "Choose an executive" }, ...owners.map((owner) => ({ value: owner.id, label: owner.full_name }))]} />
      <div className="space-y-1.5"><Label htmlFor={`${activeId}-interest`}>Default procedure of interest</Label><Input id={`${activeId}-interest`} name="interest" maxLength={120} defaultValue={form.default_procedure_interest ?? ""} /></div>
      {form.questions.map((question) => <Choice key={question.key} name={`mapping:${question.key}`} label={question.label || question.key} defaultValue={form.field_mapping[question.key] ?? standardMapping[question.key] ?? "extra"} options={CRM_FIELDS.map((value) => ({ value, label: fieldLabels[value] }))} />)}
      <div className="flex items-center gap-2"><Checkbox id={activeId} name="active" defaultChecked={form.active} /><Label htmlFor={activeId}>Receive enquiries from this form</Label></div>
    </MetaForm>{form.active ? <MetaForm action={backfillMetaLeads} label="Import recent enquiries" paging><input type="hidden" name="formId" value={form.form_id} /><p className="text-xs text-muted-foreground">Imports up to 25 at a time. Previously received enquiries are skipped.</p></MetaForm> : null}
  </DialogContent></Dialog>;
}
