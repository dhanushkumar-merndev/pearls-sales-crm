"use client";

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import type { ActionState } from "@/types/hospital";
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";
import { formatInr } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveLeadPackage, saveReferralPartner, setLeadReferralPartner } from "./actions";
import type { PartnerOption, ReferralRow } from "./schema";

const initial: ActionState = { ok: false };

function Feedback({ state }: { state: ActionState }) {
  if (state.ok || (!state.message && !state.fieldErrors)) return null;
  return <Alert variant="destructive"><AlertDescription role="status">{state.message}{state.fieldErrors ? <ul>{Object.entries(state.fieldErrors).map(([field, errors]) => <li key={field}>{errors.join(" ")}</li>)}</ul> : null}</AlertDescription></Alert>;
}
function Field({ label, name, defaultValue, required, maxLength, inputMode, type = "text", hint }: { label: string; name: string; defaultValue?: string; required?: boolean; maxLength?: number; inputMode?: "decimal" | "tel"; type?: string; hint?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} name={name} type={type} defaultValue={defaultValue} required={required} maxLength={maxLength} inputMode={inputMode} />{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>;
}
function Notes({ name = "notes", label = "Notes", defaultValue }: { name?: string; label?: string; defaultValue?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Textarea id={id} name={name} rows={2} maxLength={1000} defaultValue={defaultValue} /></div>;
}
function Picker({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><input type="hidden" name={name} value={value} />
    <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value || "none"} value={o.value} label={o.label}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}

export type PartnerItem = { id: string; name: string; organization: string | null; phone_normalized: string | null; default_incentive_bps: number; notes: string | null; active: boolean };

export function PartnerDialog({ item }: { item?: PartnerItem }) {
  const [state, action, pending] = useActionState(saveReferralPartner, initial);
  const { open, setOpen } = useAutoCloseDialog(state, "Referral partner saved.");
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size={item ? "sm" : "default"} variant={item ? "ghost" : "default"} />}>{item ? <Pencil /> : <Plus />}{item ? "Edit" : "Add Partner"}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <form action={action} className="contents">
        <DialogHeader><DialogTitle>{item ? "Edit" : "Add"} referral partner</DialogTitle><DialogDescription>The default incentive applies to new conversions; each lead can override it.</DialogDescription></DialogHeader>
        <input type="hidden" name="id" value={item?.id ?? ""} />
        <Feedback state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Partner name *" name="name" defaultValue={item?.name} required maxLength={160} />
          <Field label="Organisation" name="organization" defaultValue={item?.organization ?? ""} maxLength={160} />
          <Field label="Mobile number" name="phone" type="tel" inputMode="tel" defaultValue={item?.phone_normalized ?? ""} maxLength={40} />
          <Field label="Default incentive (%)" name="incentive" inputMode="decimal" defaultValue={item ? String(item.default_incentive_bps / 100) : "10"} required hint="Paid on amount collected, capped at package value." />
        </div>
        <Notes defaultValue={item?.notes ?? ""} />
        <label className="flex items-center gap-2 text-sm"><Checkbox name="active" defaultChecked={item?.active ?? true} /> Active</label>
        <DialogFooter showCloseButton><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : null}Save Partner</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function LeadPackageDialog({ row }: { row: ReferralRow }) {
  const [state, action, pending] = useActionState(saveLeadPackage, initial);
  const { open, setOpen } = useAutoCloseDialog(state, "Package saved.");
  const [payout, setPayout] = useState(row.payout_status ?? "pending");
  const canPay = row.lead_status === "converted" && !!row.partner_id;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" variant="outline" />}>{row.payout_status ? "Edit" : "Add package"}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <form action={action} className="contents">
        <DialogHeader><DialogTitle>Package & incentive</DialogTitle><DialogDescription>{row.lead_name ?? "Enquiry"}{row.partner_name ? ` · referred by ${row.partner_name}` : ""}</DialogDescription></DialogHeader>
        <input type="hidden" name="leadId" value={row.lead_id} />
        <Feedback state={state} />
        <Field label="Procedure / package *" name="packageName" defaultValue={row.package_name ?? ""} required maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Package value (₹) *" name="packageValue" inputMode="decimal" defaultValue={row.package_value_paise != null ? (Number(row.package_value_paise) / 100).toFixed(2) : ""} required />
          <Field label="Incentive (%)" name="incentive" inputMode="decimal" defaultValue={String((row.incentive_bps ?? 0) / 100)} required />
        </div>
        {row.collected_paise != null ? <p className="text-sm text-muted-foreground">Collected since conversion: <span className="font-medium text-foreground tabular-nums">{formatInr(Number(row.collected_paise))}</span></p> : null}
        <Picker label="Payout status" name="payoutStatus" value={payout} onChange={setPayout} options={[{ value: "pending", label: "Pending" }, ...(canPay || payout === "paid" ? [{ value: "paid", label: "Paid" }] : []), { value: "not_eligible", label: "Not eligible" }]} />
        {payout === "paid" ? <Field label="Payout reference" name="payoutReference" defaultValue={row.payout_reference ?? ""} maxLength={200} hint={row.payout_status === "paid" ? "The paid amount is locked. Set Pending to recalculate." : "The incentive is calculated and locked when you save."} /> : <input type="hidden" name="payoutReference" value="" />}
        <Notes defaultValue={row.package_notes ?? ""} />
        <DialogFooter showCloseButton><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : null}Save</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** Admin control on the lead page. */
export function LeadPartnerForm({ leadId, partnerId, partners }: { leadId: string; partnerId: string | null; partners: PartnerOption[] }) {
  const [state, action, pending] = useActionState(setLeadReferralPartner, initial);
  const [value, setValue] = useState(partnerId ?? "");
  return <form action={action} className="space-y-3"><input type="hidden" name="leadId" value={leadId} />
    <Picker label="Referred by" name="partnerId" value={value} onChange={setValue} options={[{ value: "", label: "No referral partner" }, ...partners.map((p) => ({ value: p.id, label: p.name }))]} />
    {state.message ? <Alert variant={state.ok ? "default" : "destructive"}><AlertDescription role="status">{state.message}</AlertDescription></Alert> : null}
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Update referral"}</Button>
  </form>;
}

export function ReferralFilters({ source, partner, status, partners }: { source?: string; partner?: string; status?: string; partners: PartnerOption[] }) {
  const router = useRouter();
  const filter = (name: string, label: string, value: string | undefined, options: { value: string; label: string }[]) =>
    <Select value={value || "all"} onValueChange={(next) => { const params = new URLSearchParams(window.location.search); if (!next || next === "all") params.delete(name); else params.set(name, String(next)); params.delete("page"); router.push(`${window.location.pathname}?${params}`); }}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all" label={label}>{label}</SelectItem>{options.map((o) => <SelectItem key={o.value} value={o.value} label={o.label}>{o.label}</SelectItem>)}</SelectContent>
    </Select>;
  return <>
    {filter("source", "All sources", source, [{ value: "referral", label: "Referral" }, { value: "meta", label: "Meta" }, { value: "manual", label: "Manual" }])}
    {filter("partner", "All partners", partner, partners.map((p) => ({ value: p.id, label: p.name })))}
    {filter("status", "All statuses", status, [
      { value: "incentive_due", label: "Incentive due" }, { value: "incentive_paid", label: "Incentive paid" },
      { value: "awaiting_payment", label: "Awaiting payment" }, { value: "package_pending", label: "Package pending" },
      { value: "not_eligible", label: "Not eligible" }, { value: "converted", label: "Converted (no partner)" },
      { value: "booked", label: "Booked" }, { value: "lost", label: "Lost" },
    ])}
  </>;
}
